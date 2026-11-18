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
  ['no slug, no title', () => [bundleOf({ title: '' }), null, null, path.join(root, 'Untitled-Project')]],
  ['the personal space', () => [{ project: { id: 'me', personal: true, folder_slug: 'Salt-Hours' } }, null, null, null]],
  ['no configured root', () => [bundleOf({ folder_slug: 'Salt-Hours' }), () => { rootNow = null }, null, null]],
]
// The rows where the tip answered the configured root ITSELF (OUTSTANDING F9-02).
const ROOT_ROWS = [
  ['no slug, a title with no letter fileSlugify keeps (東京)', () => bundleOf({ folder_slug: null, title: '東京' })],
  ['an in-flight slug of \'\' (the create route\'s, a PATCH\'s) and 🎬', () => bundleOf({ folder_slug: '', title: '🎬' })],
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
  for (const [name, row] of ROOT_ROWS) {
    it(`🚨 ${name}: never the configured root itself (the tip answered the root)`, () => {
      const bundle = row()
      const { projectFolderOf } = folders()
      expect(tipResolveProjectFolder(bundle)).toBe(root)
      expect(tipResolveProjectFolderRoot(bundle)).toBe(root)
      expect(projectFolderOf(bundle, { mustExist: false })).toBe(path.join(root, 'Untitled-Project'))
      expect(projectFolderOf(bundle, { mustExist: true })).toBeNull()
    })
  }
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
    expect(projectSlugOf({ title: 2026 })).toBe('2026') // a number in a body: no throw
    expect(projectSlugOf(null)).toBe('Untitled-Project')
  })
  it('an asset\'s: the stored slug as it is, else the name\'s, else Untitled-Asset', () => {
    const { assetSlugOf } = folders()
    expect(assetSlugOf({ folder_slug: 'Hero_Prop', name: 'x' })).toBe('Hero_Prop')
    expect(assetSlugOf({ folder_slug: '', name: 'hero prop' })).toBe('Hero-Prop')
    expect(assetSlugOf({ folder_slug: '', name: '東京' })).toBe('Untitled-Asset')
    expect(assetSlugOf(undefined)).toBe('Untitled-Asset')
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
    expect(answered.folder_root).toBe(path.join(fresh, 'Untitled-Project'))
    expect(answered.folder_slug).toBe('Untitled-Project')
    expect(fs.readdirSync(fresh)).toEqual(['Untitled-Project'])
    expect(fs.readdirSync(path.join(fresh, 'Untitled-Project')).sort()).toEqual(['ASSETS', 'INVOICES', 'LEGAL', 'Untitled-Project_DATABASES', 'Untitled-Project_FILES'])
    expect(written).toHaveLength(1)
  })
})

describe('the asset DELETE: an asset whose name slugs to nothing trashes its own folder, not ASSETS', () => {
  it('🚨 deleting 東京 leaves Hero\'s folder where it is', () => {
    const proj = path.join(tmp, 'Del', 'Salt-Hours')
    fs.mkdirSync(path.join(proj, 'ASSETS', 'Hero'), { recursive: true })
    fs.writeFileSync(path.join(proj, 'ASSETS', 'Hero', 'Salt-Hours_Hero_v001.png'), 'x')
    const bundle = {
      project: { id: 'p1', folder_root: proj, folder_slug: 'Salt-Hours' },
      assets: [{ id: 'a1', name: 'Hero', folder_slug: 'Hero' }, { id: 'a2', name: '東京', folder_slug: '' }],
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
    expect(bundle.assets.map((a) => a.id)).toEqual(['a1'])
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

  it('a project with its own folder: the helper\'s destination is accepted', async () => {
    const project = { id: 'p1', folder_root: elsewhere, folder_slug: 'Salt-Hours' }
    const dest = await projectDiskPath({ project, api: api({}), rel: 'ASSETS/Hero/' })
    const out = await fenceFor({ p1: { project } })('p1', dest)
    expect(out.finalPath).toBe(path.join(elsewhere, 'ASSETS', 'Hero', 'Salt-Hours_Take_v001.mov'))
  })
  it('a project under the configured root, its folder not made yet: accepted, and made', async () => {
    const project = { id: 'p2', folder_slug: 'Moon-Rise', title: 'Moon Rise' }
    const dest = await projectDiskPath({ project, api: api({ effectiveRootDir: root }), rel: 'SCENES/Dawn' })
    const out = await fenceFor({ p2: { project } })('p2', dest)
    expect(out.finalPath).toBe(path.join(root, 'Moon-Rise', 'SCENES', 'Dawn', 'Salt-Hours_Take_v001.mov'))
  })
  it('a stored root that is not usable here is refused, as it was', async () => {
    usable = (p) => p !== elsewhere
    const project = { id: 'p3', folder_root: elsewhere, folder_slug: 'Salt-Hours' }
    const dest = await projectDiskPath({ project, api: api({ effectiveRootDir: root }), rel: 'ASSETS/Hero' })
    await expect(fenceFor({ p3: { project } })('p3', dest)).rejects.toThrow("WILSON copies files only into this project's own folder.")
  })
  it('another project\'s folder, and a folder outside the root, are refused', async () => {
    const project = { id: 'p4', folder_slug: 'Salt-Hours', title: 'Salt Hours' }
    const fence = fenceFor({ p4: { project } })
    await expect(fence('p4', path.join(root, 'Moon-Rise', 'ASSETS'))).rejects.toThrow("this project's own folder")
    await expect(fence('p4', path.join(tmp, 'Elsewhere'))).rejects.toThrow("this project's own folder")
  })
})
