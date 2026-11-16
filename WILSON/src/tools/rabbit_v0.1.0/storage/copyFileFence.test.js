// =============================================================================
// copyFileFence.test.js — what rabbit:copy-file may read and where it may write
// (electron/copyFileFence.cjs), on a real temp folder.
//
// The handler used to copy any path a page named to any folder a page named.
// A source must now be a file the person picked in this launch's dialog, or a
// project body in WILSON's own data; a destination must be inside the project's
// own folder, by name and by real path. Every refusal below has a presence
// control beside it, and the main.cjs wiring is read as source.
//
// No Windows path is typed here: a backslash is built where a test needs one.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, relative, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const fence = require(resolve(here, '../../../../electron/copyFileFence.cjs'))
const { createCopyFile, makeProjectCopyRoots } = fence
const BACKSLASH = String.fromCharCode(92)

const BODY = 'the picked file, whole'

let base, projects, media, data, root, outside, pickedFile, unpicked, ownFile, tokens, sent, picks, handler

const event = () => ({ sender: { send: (channel, payload) => sent.push({ channel, payload }) } })
const key = (p) => resolve(p).toLowerCase()
const pick = (p) => picks.add(key(p))
const copy = (opts) => handler(event(), opts)
const refused = async (opts, words) => {
  await expect(copy(opts)).rejects.toThrow(words)
  expect(sent).toEqual([])
}
const ask = (over = {}) => ({ sourcePath: pickedFile, projectId: 'p1', destDir: join(root, 'LEVELS', 'Lamp-Room'), destFileName: 'Salt_brief_v001.pdf', ...over })

// Every file under the folder, so "nothing was written" is measured.
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const at = join(dir, e.name)
  if (e.isSymbolicLink()) return []
  return e.isDirectory() ? [at, ...filesUnder(at)] : [at]
})

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'copy-file-fence-'))
  data = join(base, 'rabbit-data')
  projects = join(data, 'projects')
  media = join(data, 'local-media')
  root = join(base, 'Studio', 'Salt-Hours')
  outside = join(base, 'outside')
  mkdirSync(join(projects, 'p1', 'files'), { recursive: true })
  mkdirSync(media, { recursive: true })
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  mkdirSync(join(base, 'in'), { recursive: true })
  pickedFile = join(base, 'in', 'brief.pdf')
  unpicked = join(base, 'in', 'secret.txt')
  ownFile = join(projects, 'p1', 'files', 'own.pdf')
  tokens = join(data, 'gdrive-tokens.json')
  writeFileSync(pickedFile, BODY)
  writeFileSync(unpicked, 'never picked')
  writeFileSync(ownFile, 'a body WILSON keeps')
  writeFileSync(tokens, '{"refreshToken":"x"}')
  writeFileSync(join(media, 'clip.mov'), 'a private project body')
  sent = []
  picks = new Set()
  handler = createCopyFile({
    fs,
    isPicked: (p) => picks.has(key(p)),
    ownDataRoots: () => [projects, media],
    projectRoots: (id) => (id === 'p1' ? [root] : []),
  })
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('the source: a file the person picked, or a body in WILSON\'s own data', () => {
  it('a path that was never picked is refused, and nothing is written or told', async () => {
    await refused(ask({ sourcePath: unpicked }), /Pick the file again/)
    expect(filesUnder(root)).toEqual([])
  })
  it('CONTROL: a picked one copies, whole, into the named folder, with its progress', async () => {
    pick(pickedFile)
    const out = await copy(ask())
    const at = join(root, 'LEVELS', 'Lamp-Room', 'Salt_brief_v001.pdf')
    expect(out).toEqual({ ok: true, finalPath: at, bytesWritten: BODY.length })
    expect(readFileSync(at, 'utf8')).toBe(BODY)
    expect(sent.at(-1)).toEqual({ channel: 'rabbit:copy-progress', payload: { fileName: 'Salt_brief_v001.pdf', bytesCopied: BODY.length, totalBytes: BODY.length, percent: 100 } })
  })
  it('a pick is that file, not its neighbour, and however the page spells the path it is still that file', async () => {
    pick(pickedFile)
    await refused(ask({ sourcePath: unpicked }), /Pick the file again/)
    const spelled = join(base, 'in', '..', 'in', 'BRIEF.pdf')
    if (existsSync(spelled)) { // a file system that folds case, as Windows does
      expect((await copy(ask({ sourcePath: spelled }))).ok).toBe(true)
    }
  })
  it('never picked and not there says the same as never picked and there: the refusal is no way to probe the disk', async () => {
    await refused(ask({ sourcePath: join(base, 'in', 'no-such-file.txt') }), /Pick the file again/)
  })
  it('CONTROL: picked and since removed says so', async () => {
    pick(pickedFile)
    rmSync(pickedFile)
    await refused(ask(), /source file does not exist/)
  })
  it('CONTROL: a body in a project of WILSON\'s own data copies, and one in the local media folder, unpicked', async () => {
    expect((await copy(ask({ sourcePath: ownFile }))).ok).toBe(true)
    expect((await copy(ask({ sourcePath: join(media, 'clip.mov'), destFileName: 'clip.mov' }))).ok).toBe(true)
  })
  it('the keys beside the projects folder are not "own data" for a copy: the Drive tokens stay refused', async () => {
    await refused(ask({ sourcePath: tokens }), /Pick the file again/)
  })
  it('a walk out of the own-data folder is refused, however it starts', async () => {
    await refused(ask({ sourcePath: join(projects, '..', 'gdrive-tokens.json') }), /Pick the file again/)
    await refused(ask({ sourcePath: join(projects, 'p1', '..', '..', '..', 'in', 'secret.txt') }), /Pick the file again/)
    await refused(ask({ sourcePath: `${projects}-not/x.txt` }), /Pick the file again/)
  })
  it('a junction inside the own-data folder that leads out of it is refused by its real path', async () => {
    const link = join(projects, 'jx')
    symlinkSync(join(base, 'in'), link, 'junction')
    await refused(ask({ sourcePath: join(link, 'secret.txt') }), /Pick the file again/)
  })
  it('a folder is not a file to copy', async () => {
    await refused(ask({ sourcePath: join(projects, 'p1') }), /is not a file/)
    expect(filesUnder(root)).toEqual([])
  })
  it('a call with no usable source is a refusal, not a crash in the handler', async () => {
    for (const bad of [undefined, null, '', 7, {}, ['x']]) await refused(ask({ sourcePath: bad }), /Pick the file again/)
    await expect(handler(event(), undefined)).rejects.toThrow(/Pick the file again/)
  })
})

describe('the destination: inside the project\'s own folder', () => {
  beforeEach(() => pick(pickedFile))

  it('a destination outside the contained folder is refused, and the folder is not made', async () => {
    const away = join(outside, 'made-by-a-page')
    await refused(ask({ destDir: away }), /this project's own folder/)
    expect(existsSync(away)).toBe(false)
    expect(filesUnder(outside)).toEqual([])
  })
  it('a walk out of the folder is refused; a sibling that shares its name is outside it', async () => {
    await refused(ask({ destDir: join(root, '..', '..', 'outside') }), /this project's own folder/)
    await refused(ask({ destDir: join(root, 'LEVELS', '..', '..', 'Other-Project') }), /this project's own folder/)
    await refused(ask({ destDir: `${root}-Copy` }), /this project's own folder/)
    expect(existsSync(`${root}-Copy`)).toBe(false)
  })
  it('CONTROL: the project\'s folder itself, a folder not there yet, and a project folder not there yet all copy', async () => {
    expect((await copy(ask({ destDir: root }))).ok).toBe(true)
    expect(readFileSync(join(root, 'Salt_brief_v001.pdf'), 'utf8')).toBe(BODY)
    expect((await copy(ask({ destDir: join(root, 'SCENES', 'Dawn', 'The-Door') }))).ok).toBe(true)
    rmSync(root, { recursive: true, force: true })
    expect((await copy(ask({ destDir: join(root, 'SHOTS', 'New') }))).ok).toBe(true)
    expect(statSync(join(root, 'SHOTS', 'New', 'Salt_brief_v001.pdf')).size).toBe(BODY.length)
  })
  it('the file name is one plain name: no walking, no separators, no second stream on the file', async () => {
    for (const bad of [
      `..${sep}..${sep}evil.txt`, '../evil.txt', ['..', '..', 'evil.txt'].join(BACKSLASH), 'a/b.txt', ['a', 'b.txt'].join(BACKSLASH),
      'brief.pdf:hidden', '.', '..', '', undefined, 7,
    ]) {
      await refused(ask({ destFileName: bad }), /this project's own folder/)
    }
    expect(filesUnder(base).filter((f) => f.endsWith('evil.txt'))).toEqual([])
  })
  it('a junction inside the project folder that leads out of it is refused by its real path', async () => {
    const link = join(root, 'jx')
    symlinkSync(outside, link, 'junction')
    await refused(ask({ destDir: link }), /this project's own folder/)
    await refused(ask({ destDir: join(link, 'deeper') }), /this project's own folder/)
    expect(existsSync(join(outside, 'deeper'))).toBe(false)
    expect(filesUnder(outside)).toEqual([])
  })
  it('a link standing where the file would land is not written through, even one leading nowhere yet', async (ctx) => {
    const target = join(outside, 'landed.txt')
    mkdirSync(join(root, 'LEVELS'), { recursive: true })
    try { symlinkSync(target, join(root, 'LEVELS', 'Salt_brief_v001.pdf'), 'file') } catch { ctx.skip(); return } // Windows without the right to make one
    await refused(ask({ destDir: join(root, 'LEVELS') }), /this project's own folder/)
    expect(existsSync(target)).toBe(false)
  })
  it('a project the bundle does not know, or none named, has no folder to copy into', async () => {
    await refused(ask({ projectId: 'someone-else' }), /this project's own folder/)
    await refused(ask({ projectId: undefined }), /this project's own folder/)
  })
  it('the other project\'s folder is not this project\'s folder', async () => {
    const other = join(base, 'Studio', 'Other')
    mkdirSync(other, { recursive: true })
    await refused(ask({ destDir: other }), /this project's own folder/)
    expect(filesUnder(other)).toEqual([])
  })
  it('the local server not started yet (no roots to ask) refuses', async () => {
    const early = createCopyFile({ fs, isPicked: () => true, ownDataRoots: () => [], projectRoots: () => [] })
    await expect(early(event(), ask())).rejects.toThrow(/this project's own folder/)
  })
  it('a source check that throws (the demo folder gone) closes the fence and does not open it', async () => {
    const broken = createCopyFile({ fs, isPicked: () => false, ownDataRoots: () => { throw new Error('gone') }, projectRoots: () => [root] })
    await expect(broken(event(), ask({ sourcePath: ownFile }))).rejects.toThrow(/Pick the file again/)
  })
})

describe('makeProjectCopyRoots: which folders are the project\'s', () => {
  const bundleOf = (project) => ({ project })
  const roots = (bundle, { usable = () => true, fallback = 'FALLBACK' } = {}) => makeProjectCopyRoots({
    readRabbitBundle: (id) => (id === 'p1' ? bundle : null),
    resolveProjectFolderRoot: () => fallback,
    storedRootUsable: usable,
  })('p1')

  it('the root main resolves the project\'s files under, and the stored one where the person could have chosen it', () => {
    expect(roots(bundleOf({ folder_root: 'STORED' }))).toEqual(['STORED', 'FALLBACK'])
    expect(roots(bundleOf({}))).toEqual(['FALLBACK'])
  })
  it('a stored root the open demo folder does not allow is not one (a copied folder\'s bundle is somebody else\'s record)', () => {
    expect(roots(bundleOf({ folder_root: 'STORED' }), { usable: () => false })).toEqual(['FALLBACK'])
  })
  it('no bundle, and no root resolving, give nothing', () => {
    expect(makeProjectCopyRoots({ readRabbitBundle: () => null, resolveProjectFolderRoot: () => 'X', storedRootUsable: () => true })('p1')).toEqual([])
    expect(roots(bundleOf({}), { fallback: null })).toEqual([])
  })
})

describe('the wiring: main.cjs, the bridge and the two callers', () => {
  const read = (rel) => readFileSync(resolve(here, rel), 'utf8').replace(/\r\n/g, '\n')
  const MAIN = read('../../../../electron/main.cjs')
  const between = (a, b) => MAIN.slice(MAIN.indexOf(a), MAIN.indexOf(b, MAIN.indexOf(a)))

  it('the channel is the fence, and main keeps no second copy of the stream', () => {
    const at = between("ipcMain.handle('rabbit:copy-file'", "ipcMain.handle('rabbit:get-file-stats'")
    expect(at).toContain('createCopyFile({')
    expect(at).toContain('isPicked: (p) => userAuthorizedFiles.has(path.resolve(p).toLowerCase())')
    expect(at).toContain('projectRoots: (projectId) => (rabbitProjectCopyRoots ? rabbitProjectCopyRoots(projectId) : [])')
    expect(at).toContain('ownDataRoots: copyOwnDataRoots')
    expect(MAIN).not.toContain('fs.createReadStream(sourcePath)')
    expect((MAIN.match(/'rabbit:copy-file'/g) || []).length).toBe(1)
  })
  it('own data is the projects folder and the local media folder, never the whole data folder (the keys live there)', () => {
    const at = between('function copyOwnDataRoots(', '\n}\n')
    expect(at).toContain("path.join(getRabbitDataDir(), 'projects')")
    expect(at).toContain('getLocalMediaRoot({ create: false })')
    expect(at).not.toMatch(/(?:\[|push\()\s*getRabbitDataDir\(\)/)
  })
  it('only the file dialog feeds the picked list, memory only, declared once: a pick for a picture or a folder is not consent for a copy', () => {
    expect((MAIN.match(/const userAuthorizedFiles\b/g) || []).length).toBe(1)
    expect((MAIN.match(/userAuthorizedFiles\.add\(/g) || []).length).toBe(1)
    const pickFiles = between("ipcMain.handle('rabbit:pick-files'", "ipcMain.handle('rabbit:copy-file'")
    expect(pickFiles).toContain('for (const picked of result.filePaths) userAuthorizedFiles.add(path.resolve(picked).toLowerCase());')
    expect(pickFiles.indexOf('result.canceled')).toBeLessThan(pickFiles.indexOf('userAuthorizedFiles.add'))
  })
  it('the roots come from main\'s own resolvers, set where the bundle readers live', () => {
    expect(MAIN).toContain("rabbitProjectCopyRoots = require('./copyFileFence.cjs').makeProjectCopyRoots({")
    const at = MAIN.slice(MAIN.indexOf('rabbitProjectCopyRoots = require('), MAIN.indexOf('rabbitProjectCopyRoots = require(') + 200)
    expect(at).toContain('readRabbitBundle, resolveProjectFolderRoot, storedRootUsable')
  })
  it('the bridge passes the page\'s object through, and exactly two files in src/ call it, both with a dialog\'s path and the record\'s project', () => {
    expect(read('../../../../electron/preload.cjs')).toContain("copyFile:             (opts) => ipcRenderer.invoke('rabbit:copy-file', opts),")
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const at = join(dir, e.name)
      return e.isDirectory() ? walk(at) : /\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name) ? [at] : []
    })
    const srcDir = resolve(here, '../../..')
    const callers = walk(srcDir).filter((f) => /\.copyFile\(/.test(readFileSync(f, 'utf8'))).map((f) => relative(srcDir, f).split(sep).join('/')).sort()
    expect(callers).toEqual(['tools/rabbit_v0.1.0/components/FileManager.jsx', 'tools/rabbit_v0.1.0/components/entityFiles.js'])
    const fileManager = read('../components/FileManager.jsx')
    expect(fileManager).toContain('const filePaths = await api.pickFiles()')
    expect(fileManager).toContain('sourcePath: srcPath,')
    expect(fileManager).toContain('projectId: record.project_id,')
    expect(read('../components/entityFiles.js')).toContain('projectId: record.project_id')
    const form = read('../views/EntityListView.jsx')
    expect(form).toContain('const paths = await api.pickFiles()')
    expect(form).toContain("name: String(p).replace(/\\\\/g, '/').split('/').pop(), path: p")
  })
})
