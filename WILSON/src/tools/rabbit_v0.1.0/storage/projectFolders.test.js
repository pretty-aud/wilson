// =============================================================================
// projectFolders.test.js — F9 item 2 (the desktop-build review's A1): "where is
// this project's folder on this computer", answered once
// (electron/projectFolders.cjs), run for real on a temp root; the renderer's
// one helper (components/projectDiskPath.js) handed to the real copy fence.
//
// The failing controls, each red on the tip (81df858b) before this commit:
//   · a project titled 東京 was created with folder_root = the configured root
//     itself, and bare _DATABASES and _FILES made there;
//   · deleting an asset named 東京 (its slug '') moved the whole ASSETS folder
//     to .trash, every other asset's folder with it;
//   · main.cjs held two resolvers, not two bindings of one.
// And the table: every caller of the two old resolvers (copied below from the
// tip, word for word) gets the answer it got, a missing folder included, but
// for the rows where the old answer was the configured root itself.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectDiskPath } from '../components/projectDiskPath'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const ELECTRON = path.resolve(here, '../../../../electron')
const requireElectron = createRequire(path.join(ELECTRON, 'main.cjs'))
const { resolveContainedFilePath } = requireElectron('./pathContainment.cjs')
const { createCopyFile, makeProjectCopyRoots } = requireElectron('./copyFileFence.cjs')
const rabbitTableViews = requireElectron('./rabbitTableViews.cjs')
const rabbitTaskItems = requireElectron('./rabbitTaskItems.cjs')
const made = (() => { try { return requireElectron('./projectFolders.cjs') } catch { return null } })()

const MAIN = fs.readFileSync(path.join(ELECTRON, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs has no function ${name}`)
  const open = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error(`unbalanced braces in ${name}`)
}
function extractRouteBody(source, head) {
  const start = source.indexOf(head)
  if (start < 0) throw new Error(`main.cjs no longer registers ${head}`)
  const open = source.indexOf('{', source.indexOf('=>', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(open, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${head}`)
}
// main.cjs's own fileSlugify, lifted (it throws on a non-string, as there).
const fileSlugify = new Function(`${extractFunction(MAIN, 'fileSlugify')}\nreturn fileSlugify;`)()

let tmp, root, elsewhere, usable, rootNow
const isPersonalBundle = (b) => b?.project?.personal === true
const storedRootUsable = (p) => usable(p)
const resolveConfiguredRootDir = () => rootNow
const folders = () => made.createProjectFolders({ fs, path, fileSlugify, isPersonalBundle, storedRootUsable, resolveConfiguredRootDir })

// The tip's two resolvers, word for word (main.cjs at 81df858b, :1876 and :3028).
function tipResolveProjectFolder(bundle) {
  if (isPersonalBundle(bundle)) return null
  const r = bundle?.project?.folder_root
  if (r && fs.existsSync(r) && storedRootUsable(r)) return r
  const rootBase = resolveConfiguredRootDir()
  if (!rootBase) return null
  const slug = bundle?.project?.folder_slug || fileSlugify(bundle?.project?.title || 'Untitled-Project')
  const resolved = path.join(rootBase, slug)
  return fs.existsSync(resolved) ? resolved : null
}
function tipResolveProjectFolderRoot(bundle) {
  if (isPersonalBundle(bundle)) return null
  const projectRoot = bundle.project?.folder_root
  if (projectRoot && fs.existsSync(projectRoot) && storedRootUsable(projectRoot)) return projectRoot
  const rootBase = resolveConfiguredRootDir()
  if (!rootBase) return null
  const slug = fileSlugify(bundle.project?.title || 'Untitled-Project')
  const stored = bundle.project?.folder_slug
  const safe = stored ? fileSlugify(String(stored)) : ''
  return path.join(rootBase, safe || slug)
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f9-folders-'))
  root = path.join(tmp, 'Projects')
  elsewhere = path.join(tmp, 'Elsewhere', 'Salt')
  fs.mkdirSync(path.join(root, 'Salt-Hours'), { recursive: true })
  fs.mkdirSync(elsewhere, { recursive: true })
})
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }) })
beforeEach(() => { rootNow = root; usable = () => true })

const bundleOf = (project) => ({ project: { id: 'p1', ...project } })
// [name, () => [bundle, setup, the answer with mustExist, without]] — built in
// the test, once the temp root exists.
const ROWS = [
  ['the stored root, there and usable', () => [bundleOf({ folder_root: elsewhere, folder_slug: 'Salt-Hours' }), null, elsewhere, elsewhere]],
  ['the stored root gone: the configured root and the slug', () => [bundleOf({ folder_root: path.join(tmp, 'Gone'), folder_slug: 'Salt-Hours' }), null, path.join(root, 'Salt-Hours'), path.join(root, 'Salt-Hours')]],
  ['the stored root not usable here (a copied demo folder)', () => [bundleOf({ folder_root: elsewhere, folder_slug: 'Salt-Hours' }), () => { usable = () => false }, path.join(root, 'Salt-Hours'), path.join(root, 'Salt-Hours')]],
  ['the slug\'s folder there', () => [bundleOf({ folder_slug: 'Salt-Hours', title: 'Salt Hours' }), null, path.join(root, 'Salt-Hours'), path.join(root, 'Salt-Hours')]],
  ['the slug\'s folder not made yet', () => [bundleOf({ folder_slug: 'Moon', title: 'Moon' }), null, null, path.join(root, 'Moon')]],
  ['no slug: the title\'s', () => [bundleOf({ folder_slug: null, title: 'Salt Hours' }), null, path.join(root, 'Salt-Hours'), path.join(root, 'Salt-Hours')]],
  ['the personal space', () => [{ project: { id: 'me', personal: true, folder_slug: 'Salt-Hours' } }, null, null, null]],
  ['no configured root', () => [bundleOf({ folder_slug: 'Salt-Hours' }), () => { rootNow = null }, null, null]],
]
// The rows where the tip answered the configured root ITSELF (OUTSTANDING
// F9-02), and, with them, a project with no slug and no title, which the tip
// gave a folder every such project shared: each now has its own, named by its
// id (review round 1).
const ROOT_ROWS = [
  ['no slug, a title with no letter fileSlugify keeps (東京)', () => bundleOf({ folder_slug: null, title: '東京' }), 'root'],
  ['an in-flight slug of \'\' (the create route\'s, a PATCH\'s) and 🎬', () => bundleOf({ folder_slug: '', title: '🎬' }), 'root'],
  ['no slug and no title', () => bundleOf({ title: '' }), 'shared'],
]

describe('projectFolderOf: one rule, and whether the folder must exist', () => {
  for (const [name, row] of ROWS) {
    it(name, () => {
      const [bundle, setup, withMust, without] = row()
      if (setup) setup()
      const { projectFolderOf } = folders()
      expect(projectFolderOf(bundle, { mustExist: true })).toBe(withMust)
      expect(projectFolderOf(bundle, { mustExist: false })).toBe(without)
      // CONTROL: the tip's two resolvers gave the same answers.
      expect(tipResolveProjectFolder(bundle)).toBe(withMust)
      expect(tipResolveProjectFolderRoot(bundle)).toBe(without)
    })
  }
  for (const [name, row, tipWas] of ROOT_ROWS) {
    it(`🚨 ${name}: a folder of its own (the tip answered ${tipWas === 'root' ? 'the root itself' : 'a shared one'})`, () => {
      const bundle = row()
      const { projectFolderOf } = folders()
      if (tipWas === 'root') {
        expect(tipResolveProjectFolder(bundle)).toBe(root)
        expect(tipResolveProjectFolderRoot(bundle)).toBe(root)
      } else {
        expect(tipResolveProjectFolderRoot(bundle)).toBe(path.join(root, 'Untitled-Project'))
      }
      expect(projectFolderOf(bundle, { mustExist: false })).toBe(path.join(root, 'Untitled-Project-P1'))
      expect(projectFolderOf(bundle, { mustExist: true })).toBeNull()
    })
  }
  it('two projects whose titles slug to nothing never share a folder (review round 1)', () => {
    const { projectFolderOf } = folders()
    const tokyo = projectFolderOf({ project: { id: '1a2b3c4d-0000', title: '東京' } }, { mustExist: false })
    const osaka = projectFolderOf({ project: { id: '9f8e7d6c-0000', title: '大阪' } }, { mustExist: false })
    expect(tokyo).toBe(path.join(root, 'Untitled-Project-1a2b3c4d'))
    expect(osaka).toBe(path.join(root, 'Untitled-Project-9f8e7d6c'))
  })
  it('a stored slug not in fileSlugify\'s form (a bundle never reconciled): the tip joined it raw where it must exist; now its slug', () => {
    const { projectFolderOf } = folders()
    const bundle = bundleOf({ folder_slug: 'salt_hours', title: 'Salt Hours' })
    expect(tipResolveProjectFolder(bundle)).toBeNull() // <root>/salt_hours is not there
    expect(projectFolderOf(bundle, { mustExist: true })).toBe(path.join(root, 'Salt-Hours'))
    // Harmless in use: every bundle a caller holds is reconciled first.
  })
  it('a poisoned slug on a bundle never reconciled cannot leave the root', () => {
    const { projectFolderOf } = folders()
    const answer = projectFolderOf(bundleOf({ folder_slug: '..\\..\\..', title: 'Salt Hours' }), { mustExist: false })
    expect(answer).toBe(path.join(root, 'Salt-Hours'))
  })
  it('a UNC root (path.win32): the server\'s name is kept', () => {
    const unc = '\\\\nas\\share\\Projects'
    const { projectFolderOf } = made.createProjectFolders({
      fs: { existsSync: (p) => p === unc || p === `${unc}\\Salt-Hours` }, path: path.win32, fileSlugify,
      isPersonalBundle, storedRootUsable: () => true, resolveConfiguredRootDir: () => unc,
    })
    expect(projectFolderOf(bundleOf({ folder_slug: 'Salt-Hours' }), { mustExist: true })).toBe(`${unc}\\Salt-Hours`)
  })
  it('the caller must say whether the folder must exist', () => {
    expect(() => folders().projectFolderOf(bundleOf({ folder_slug: 'Salt-Hours' }))).toThrow(/mustExist/)
  })
})

describe('projectSlugOf and assetSlugOf: never empty', () => {
  it('the project\'s', () => {
    const { projectSlugOf } = folders()
    expect(projectSlugOf({ folder_slug: 'Salt-Hours', title: 'Other' })).toBe('Salt-Hours')
    expect(projectSlugOf({ folder_slug: null, title: 'salt hours!' })).toBe('Salt-Hours')
    expect(projectSlugOf({ folder_slug: '###', title: 'Moon' })).toBe('Moon')
    expect(projectSlugOf({ title: '東京' })).toBe('Untitled-Project')
    expect(projectSlugOf({ id: 'ab12CD34-ef', title: '東京' })).toBe('Untitled-Project-Ab12cd34')
    expect(projectSlugOf({ title: 2026 })).toBe('2026') // a number in a body: no throw
    expect(projectSlugOf(null)).toBe('Untitled-Project')
    // In fileSlugify's form, so the reconcile keeps a stored one as it is.
    expect(fileSlugify(projectSlugOf({ id: 'ab12CD34-ef', title: '東京' }))).toBe('Untitled-Project-Ab12cd34')
  })
  it('an asset\'s: a stored plain segment as it is, else the name\'s, else Untitled-Asset and its id', () => {
    const { assetSlugOf } = folders()
    expect(assetSlugOf({ folder_slug: 'Hero_Prop', name: 'x' })).toBe('Hero_Prop')
    expect(assetSlugOf({ folder_slug: '', name: 'hero prop' })).toBe('Hero-Prop')
    expect(assetSlugOf({ folder_slug: '', name: '東京' })).toBe('Untitled-Asset')
    expect(assetSlugOf({ id: 'a2', folder_slug: '', name: '東京' })).toBe('Untitled-Asset-A2')
    expect(assetSlugOf(undefined)).toBe('Untitled-Asset')
    // A stored slug that is a step, not a name, is never joined (review round 1: '.' was ASSETS itself).
    for (const step of ['.', '..', 'a/b', 'a\\b', 'C:x']) expect(assetSlugOf({ folder_slug: step, name: 'Hero' }), step).toBe('Hero')
  })
})

describe('main.cjs: two bindings of the one resolver, and the slug written once', () => {
  it('resolveProjectFolder and resolveProjectFolderRoot are two bindings of the one resolver', () => {
    // The personal space's line is the MO1 rule asked first, where
    // personalSpace.routes.test.js pins it; projectFolderOf asks it too.
    const binding = (name, mustExist) => new RegExp(`^function ${name}\\(bundle\\) \\{\\s*if \\(personalSpace\\.isPersonalBundle\\(bundle\\)\\) return null;[^\\n]*\\n\\s*return projectFolders\\.projectFolderOf\\(bundle, \\{ mustExist: ${mustExist} \\}\\);\\s*\\}$`)
    expect(extractFunction(MAIN, 'resolveProjectFolder')).toMatch(binding('resolveProjectFolder', true))
    expect(extractFunction(MAIN, 'resolveProjectFolderRoot')).toMatch(binding('resolveProjectFolderRoot', false))
  })
  it('the one resolver is made with the configured root\'s one definition, by reference', () => {
    const at = MAIN.indexOf("require('./projectFolders.cjs').createProjectFolders({")
    expect(at).toBeGreaterThan(-1)
    expect(MAIN.slice(at, MAIN.indexOf('});', at))).toMatch(/storedRootUsable, resolveConfiguredRootDir,/)
  })
  it('the project slug\'s fallback is typed only where a lifted test holds the text (was on twelve lines)', () => {
    // The five lines below are lifted by other tests with fixed name lists
    // (jsonFile.test.js and setAsideDesktop.test.js the reconcile, the rebase
    // and the mirrors; the folder planner's tests the plan; the shot
    // re-filing test the managed-files POST), so they keep their own words;
    // every bundle they meet is reconciled, where they answer as
    // projectSlugOf. OUTSTANDING F9-03 carries them.
    const lines = MAIN.split('\n').filter((l) => /'Untitled-Project'|title \|\| 'Untitled'\)/.test(l)).map((l) => l.trim())
    expect(lines).toEqual([
      "const safeSlug = fileSlugify(rawSlug) || fileSlugify(String(bundle.project.title || '')) || 'Untitled-Project';",
      "const slug = fileSlugify(String(bundle.project.folder_slug || bundle.project.title || 'Untitled-Project')) || 'Untitled-Project';",
      "slug: project?.folder_slug || slugOrFallback(project?.title, 'Untitled-Project'),",
      "const slug = bundle.project.folder_slug || fileSlugify(bundle.project.title || 'Untitled-Project');",
      "const projectSlug = bundle.project?.folder_slug || fileSlugify(bundle.project?.title || 'Untitled');",
    ])
  })
})

describe('the create route: a title with nothing to slug gets its own folder (F9-02)', () => {
  function liftPost() {
    const body = extractRouteBody(MAIN, "expressApp.post('/api/rabbit/projects',")
    const names = ['fs', 'path', 'uuidv4', 'folderRootRefusal', 'fileSlugify', 'projectSlugOf', 'resolveConfiguredRootDir',
      'resolveProjectFolder', 'writeRabbitBundle', 'LEGAL_DIR']
    const src = `${extractFunction(MAIN, 'emptyBundle')}\n${extractFunction(MAIN, 'ensureProjectFolders')}\nreturn (req, res) => ${body}`
    // eslint-disable-next-line no-new-func
    return (deps) => new Function(...names, src)(...names.map((n) => deps[n]))
  }
  it('🚨 東京 is made at <root>/Untitled-Project, and nothing is made in the root itself', () => {
    const fresh = path.join(tmp, 'Fresh')
    fs.mkdirSync(fresh, { recursive: true })
    rootNow = fresh
    const pf = folders()
    const written = []
    const post = liftPost()({
      fs, path, uuidv4: () => 'p-tokyo', folderRootRefusal: () => ({ error: 'unused' }), fileSlugify,
      projectSlugOf: pf.projectSlugOf, resolveConfiguredRootDir,
      resolveProjectFolder: (b) => pf.projectFolderOf(b, { mustExist: true }),
      writeRabbitBundle: (id, b) => written.push(b), LEGAL_DIR: 'LEGAL',
    })
    let answered = null
    post({ body: { title: '東京' } }, { status() { return this }, json(b) { answered = b; return this } })
    const own = 'Untitled-Project-Ptokyo' // named by the new project's id (review round 1)
    expect(answered.folder_root).toBe(path.join(fresh, own))
    expect(answered.folder_slug).toBe(own)
    expect(fs.readdirSync(fresh)).toEqual([own])
    expect(fs.readdirSync(path.join(fresh, own)).sort()).toEqual(['ASSETS', 'INVOICES', 'LEGAL', `${own}_DATABASES`, `${own}_FILES`])
    expect(written).toHaveLength(1)
  })
})

describe('the asset DELETE: an asset whose name slugs to nothing trashes its own folder, not ASSETS', () => {
  it('🚨 deleting 東京 leaves Hero\'s folder, and 大阪\'s, where they are', () => {
    const proj = path.join(tmp, 'Del', 'Salt-Hours')
    fs.mkdirSync(path.join(proj, 'ASSETS', 'Hero'), { recursive: true })
    fs.writeFileSync(path.join(proj, 'ASSETS', 'Hero', 'Salt-Hours_Hero_v001.png'), 'x')
    // Review round 1: two names with nothing to slug have two folders.
    fs.mkdirSync(path.join(proj, 'ASSETS', 'Untitled-Asset-A3'), { recursive: true })
    fs.writeFileSync(path.join(proj, 'ASSETS', 'Untitled-Asset-A3', 'osaka.png'), 'x')
    const bundle = {
      project: { id: 'p1', folder_root: proj, folder_slug: 'Salt-Hours' },
      assets: [{ id: 'a1', name: 'Hero', folder_slug: 'Hero' }, { id: 'a2', name: '東京', folder_slug: '' }, { id: 'a3', name: '大阪', folder_slug: 'Untitled-Asset-A3' }],
      managedFiles: [], tasks: [], taskItems: [], tableViews: [], itemGroupings: [],
    }
    const pf = folders()
    const body = extractRouteBody(MAIN, "expressApp.delete('/api/rabbit/projects/:projectId/assets/:id',")
    // eslint-disable-next-line no-new-func
    const handler = new Function(
      'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'resolveProjectFolderRoot', 'fileSlugify', 'assetSlugOf',
      'resolveContainedFilePath', 'path', 'fs', 'rabbitTableViews', 'rabbitTaskItems', 'console',
      `${extractFunction(MAIN, 'rabbitRemoveFrom')}\nreturn (req, res) => ${body}`,
    )(() => bundle, () => {}, (res) => res.status(404).json({}), (b) => pf.projectFolderOf(b, { mustExist: false }), fileSlugify,
      pf.assetSlugOf, resolveContainedFilePath, path, fs, rabbitTableViews, rabbitTaskItems, { error() {} })
    handler({ params: { projectId: 'p1', id: 'a2' }, body: {}, query: {} }, { status() { return this }, json() { return this } })
    expect(fs.existsSync(path.join(proj, 'ASSETS', 'Hero', 'Salt-Hours_Hero_v001.png'))).toBe(true)
    expect(fs.existsSync(path.join(proj, 'ASSETS', 'Untitled-Asset-A3', 'osaka.png'))).toBe(true)
    expect(bundle.assets.map((a) => a.id)).toEqual(['a1', 'a3'])
  })
})

describe('folderRootRefusal: never the folder every project sits in (review round 1; F9-02)', () => {
  const { checkFolderRootShape, isPathInside } = requireElectron('./pathContainment.cjs')
  const { checkDemoFolderShape } = requireElectron('./localDemoRoot.cjs')
  function refusalWith({ demoRoot = null, workspaceRootDir = null, defaultRootDir = null, picked = [] } = {}) {
    // eslint-disable-next-line no-new-func
    return new Function('path', 'checkFolderRootShape', 'checkDemoFolderShape', 'isPathInside', 'localDemoRootDir', 'localDemoProjectsDir',
      'workspaceRootDir', 'readFilesConfig', 'userAuthorizedDirs', `${extractFunction(MAIN, 'folderRootRefusal')}\nreturn folderRootRefusal;`)(
      path, checkFolderRootShape, checkDemoFolderShape, isPathInside, () => demoRoot, () => (demoRoot ? path.join(demoRoot, 'projects') : null),
      workspaceRootDir, () => ({ defaultRootDir }), new Set(picked))
  }
  it('the machine\'s storage folder itself, or a folder holding it, is refused; a folder inside it is not', () => {
    // checkFolderRootShape is Windows-only by design (a NAS root is a UNC or drive path).
    if (process.platform !== 'win32') return
    const refuse = refusalWith({ defaultRootDir: root, picked: [tmp] })
    expect(refuse(root).error).toMatch(/every project sits in/)
    expect(refuse(tmp).error).toMatch(/every project sits in/) // review round 2: picked, but it holds the root
    expect(refuse(path.join(root, 'Salt-Hours')).resolved).toBe(path.join(root, 'Salt-Hours'))
  })
  it('the routes pass the row\'s id to the slug, and the asset create stores it (review round 2: unpinned)', () => {
    expect(MAIN).toContain('if (!row.folder_slug && row.name) row.folder_slug = assetSlugOf({ id: row.id, name: row.name });')
    expect(MAIN).toContain('ensureAssetFolder(bundle, result);')
    expect(MAIN).toContain('const assetSlug = assetSlugOf(asset); // its stored slug')
    expect(MAIN).toContain('const newSlug = assetSlugOf({ id: req.params.id, name: req.body.name });')
    expect(MAIN).toContain('req.body.folder_slug = projectSlugOf({ id: bundle.project.id, folder_slug: next, title: bundle.project.title });')
    expect(MAIN).toContain('const newSlug = fileSlugify(String(req.body.title)) || oldSlug || projectSlugOf({ id: bundle.project.id, title: req.body.title });')
  })
  it('a demo folder\'s projects folder itself is refused; a project inside it is not', () => {
    const demo = path.join(tmp, 'DemoRoot')
    const refuse = refusalWith({ demoRoot: demo })
    expect(refuse(path.join(demo, 'projects')).error).toMatch(/every project sits in/)
    expect(refuse(path.join(demo, 'projects', 'Salt-Hours')).resolved).toBe(path.join(demo, 'projects', 'Salt-Hours'))
  })
  it('the workspace drive itself was refused already, and still is', () => {
    const refuse = refusalWith({ workspaceRootDir: 'D:\\Studio' })
    if (process.platform === 'win32') expect(refuse('D:\\Studio').error).toMatch(/workspace storage drive itself/)
  })
})

describe('the renderer\'s path, judged by the unchanged copy fence', () => {
  let source
  beforeAll(() => {
    source = path.join(tmp, 'picked.mov')
    fs.writeFileSync(source, 'bytes')
  })
  // The fence exactly as main.cjs builds it, fed by the one resolver.
  function fenceFor(bundles) {
    const pf = folders()
    const copy = createCopyFile({
      fs, isPicked: (p) => p === source, ownDataRoots: () => [],
      projectRoots: makeProjectCopyRoots({
        readRabbitBundle: (id) => bundles[id] || null,
        resolveProjectFolderRoot: (b) => pf.projectFolderOf(b, { mustExist: false }),
        storedRootUsable,
      }),
    })
    return (projectId, destDir, destFileName = 'Salt-Hours_Take_v001.mov') =>
      copy({ sender: { send() {} } }, { sourcePath: source, destDir, destFileName, projectId })
  }
  const api = (cfg) => ({ readFilesConfig: async () => cfg })
  // The helper answers in Windows separators, the desktop's (it ships for
  // Windows). On another host (CI is Linux) the fence's `path` reads `\tmp\…`
  // as a relative name and lands it inside the asking project's folder, so
  // there the answer goes to the fence in the host's separators; on Windows,
  // exactly as the helper gave it. (Run 44397277056, on Linux, was red without this.)
  async function destFor(project, cfg, rel) {
    const raw = await projectDiskPath({ project, api: api(cfg), rel })
    expect(raw).not.toContain('/')
    return process.platform === 'win32' ? raw : raw.replace(/\\/g, '/')
  }

  it('a project with its own folder: the helper\'s destination is accepted', async () => {
    const project = { id: 'p1', folder_root: elsewhere, folder_slug: 'Salt-Hours' }
    const dest = await destFor(project, {}, 'ASSETS/Hero/')
    const out = await fenceFor({ p1: { project } })('p1', dest)
    expect(out.finalPath).toBe(path.join(elsewhere, 'ASSETS', 'Hero', 'Salt-Hours_Take_v001.mov'))
  })
  it('a project under the configured root, its folder not made yet: accepted, and made', async () => {
    const project = { id: 'p2', folder_slug: 'Moon-Rise', title: 'Moon Rise' }
    const dest = await destFor(project, { effectiveRootDir: root }, 'SCENES/Dawn')
    const out = await fenceFor({ p2: { project } })('p2', dest)
    expect(out.finalPath).toBe(path.join(root, 'Moon-Rise', 'SCENES', 'Dawn', 'Salt-Hours_Take_v001.mov'))
  })
  it('a stored root that is not usable here is refused, as it was', async () => {
    usable = (p) => p !== elsewhere
    const project = { id: 'p3', folder_root: elsewhere, folder_slug: 'Salt-Hours' }
    const dest = await destFor(project, { effectiveRootDir: root }, 'ASSETS/Hero')
    await expect(fenceFor({ p3: { project } })('p3', dest)).rejects.toThrow("WILSON copies files only into this project's own folder.")
  })
  it('review round 1: two projects whose titles slug to nothing cannot copy into each other\'s folders', async () => {
    const tokyo = { id: '1a2b3c4d-1', title: '東京', folder_slug: 'Untitled-Project-1a2b3c4d' }
    const osaka = { id: '9f8e7d6c-2', title: '大阪', folder_slug: 'Untitled-Project-9f8e7d6c' }
    const fence = fenceFor({ t: { project: tokyo }, o: { project: osaka } })
    const intoOsaka = await destFor(osaka, { effectiveRootDir: root }, 'ASSETS/Shrine')
    await expect(fence('t', intoOsaka)).rejects.toThrow("this project's own folder")
    const intoTokyo = await destFor(tokyo, { effectiveRootDir: root }, 'ASSETS/Shrine')
    expect((await fence('t', intoTokyo)).finalPath).toBe(path.join(root, 'Untitled-Project-1a2b3c4d', 'ASSETS', 'Shrine', 'Salt-Hours_Take_v001.mov'))
  })
  it('another project\'s folder, and a folder outside the root, are refused', async () => {
    const project = { id: 'p4', folder_slug: 'Salt-Hours', title: 'Salt Hours' }
    const fence = fenceFor({ p4: { project } })
    await expect(fence('p4', path.join(root, 'Moon-Rise', 'ASSETS'))).rejects.toThrow("this project's own folder")
    await expect(fence('p4', path.join(tmp, 'Elsewhere'))).rejects.toThrow("this project's own folder")
  })
})
