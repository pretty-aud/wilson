// =============================================================================
// desktopShotRefiling.test.js — post-overhaul S4c: the Local Server's
// one-time move of shot folders into their scenes' folders, replayed on a
// REAL temp directory with the shipped functions lifted out of main.cjs
// (desktopDeleteSweep's harness): the folder planners, ensureEntityFolderRow,
// pendingShotRefilingFor, refileOneShotRow and the POST …/folders/refile-shots
// route itself (lifted as text by paren matching, so the route the desktop
// registers is the route this runs).
//
// What is pinned: directories move with everything in them, every managed
// file's record is rewritten only after the file is seen at its new place,
// the folder row goes under the scene's, one shot at a time with the bundle
// written after each (a stop part way leaves rows that say where the files
// are), nothing is ever overwritten or deleted, a second run finds nothing,
// and the SHOTS category row and directory go only once nothing is left.
// =============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { resolveContainedFilePath } = require('../../../electron/pathContainment.cjs')
const MAIN_CJS = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf-8')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}()`)
  let pd = 0
  let i = source.indexOf('(', start)
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${name}()`)
}
/** Lift `expressApp.post('<route>', …);` whole, by paren matching from the call. */
function extractRoute(source, route) {
  const marker = `expressApp.post('${route}'`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`main.cjs no longer registers ${route}`)
  let depth = 0
  for (let i = source.indexOf('(', start); i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') { depth--; if (depth === 0) return source.slice(start, i + 1) + ';' }
  }
  throw new Error(`unbalanced parens extracting ${route}`)
}
function extractArrayLiteral(source, name) {
  const start = source.indexOf(`const ${name} = [`)
  const open = source.indexOf('[', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '[') depth++
    else if (source[i] === ']') { depth--; if (depth === 0) return source.slice(open, i + 1) }
  }
  throw new Error(`cannot extract ${name}`)
}
function extractObjectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = {`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open, i + 1) }
  }
  throw new Error(`cannot extract ${name}`)
}

const ROUTE = '/api/rabbit/projects/:projectId/folders/refile-shots'

/**
 * The shipped functions over a bundle in memory and a root on disk. `fsImpl`
 * stands in for `fs` (a test can make a rename lose a file).
 */
function harness(bundle, root, fsImpl = fs) {
  const routes = new Map()
  const writes = []
  const expressApp = { post: (pattern, h) => routes.set(pattern, h) }
  let seq = 0
  const uuidv4 = () => `uuid-${++seq}`
  const readRabbitBundle = () => bundle
  const writeRabbitBundle = (_id, b) => { writes.push(structuredClone(b)) }
  const rabbitNotFound = (res) => res.status(404).json({ error: 'project not found' })
  const resolveProjectFolder = () => root
  // eslint-disable-next-line no-new-func
  const build = new Function(
    'fs', 'path', 'uuidv4', 'resolveContainedFilePath', 'resolveProjectFolder', 'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'expressApp',
    `${extractFunction(MAIN_CJS, 'fileSlugify')}
     const FOLDER_CATEGORIES = ${extractArrayLiteral(MAIN_CJS, 'FOLDER_CATEGORIES')};
     const FOLDER_ENTITY_FK = ${extractObjectLiteral(MAIN_CJS, 'FOLDER_ENTITY_FK')};
     const FOLDER_FALLBACK_NAME = ${extractObjectLiteral(MAIN_CJS, 'FOLDER_FALLBACK_NAME')};
     ${extractFunction(MAIN_CJS, 'slugOrFallback')}
     ${extractFunction(MAIN_CJS, 'planProjectFolderList')}
     ${extractFunction(MAIN_CJS, 'planEntityFolderFor')}
     ${extractFunction(MAIN_CJS, 'sceneOfShot')}
     ${extractFunction(MAIN_CJS, 'addFolderRow')}
     ${extractFunction(MAIN_CJS, 'materializeFolderDirs')}
     ${extractFunction(MAIN_CJS, 'ensureProjectFolderRows')}
     ${extractFunction(MAIN_CJS, 'ensureEntityFolderRow')}
     ${extractFunction(MAIN_CJS, 'pendingShotRefilingFor')}
     ${extractFunction(MAIN_CJS, 'refileOneShotRow')}
     ${extractRoute(MAIN_CJS, ROUTE)}
     return { ensureEntityFolderRow, pendingShotRefilingFor, refileOneShotRow, materializeFolderDirs };`,
  )
  const fns = build(fsImpl, path, uuidv4, resolveContainedFilePath, resolveProjectFolder, readRabbitBundle, writeRabbitBundle, rabbitNotFound, expressApp)
  const post = () => {
    const handler = routes.get(ROUTE)
    const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    handler({ params: { projectId: 'p1' }, body: {} }, res)
    return res
  }
  return { ...fns, post, writes }
}

const SC = (id, name) => ({ id, name, scene_id: null })
const SH = (id, name, scene_id) => ({ id, name, scene_id })
function folder(id, kind, pathStr, parentId, extra = {}) {
  const slug = pathStr.split('/').pop()
  return { id, project_id: 'p1', parent_id: parentId, kind, entity_type: extra.entity_type || null, asset_id: null, scene_id: null, shot_id: null, level_id: null, experience_id: null, slug, label: null, path: pathStr, sort_order: 0, created_at: 't', updated_at: 't', ...extra }
}
function managed(id, shotId, folderPath, storedName) {
  return { id, project_id: 'p1', shot_id: shotId, scene_id: null, asset_id: null, file_name: storedName, stored_name: storedName, folder_path: folderPath, deleted_at: null, storage_provider: 'local_managed' }
}

/** A project from before S4c: two scenes, three shots under SHOTS, files on disk. */
function fixture() {
  return {
    project: { id: 'p1', title: 'Fixture', scenes_enabled: true, folder_slug: 'Fixture' },
    scenes: [SC('sc1', 'Lighthouse, dawn'), SC('sc2', 'Cliff path')],
    shots: [SH('sh1', 'The door', 'sc1'), SH('sh2', 'The cold lamp', 'sc1'), SH('sh3', 'Loose', null)],
    folders: [
      folder('r', 'root', '', null),
      folder('c-assets', 'category', 'ASSETS', 'r', { entity_type: 'asset' }),
      folder('c-scenes', 'category', 'SCENES', 'r', { entity_type: 'scene' }),
      folder('c-shots', 'category', 'SHOTS', 'r', { entity_type: 'shot' }),
      folder('f-sc1', 'entity', 'SCENES/Lighthouse-Dawn', 'c-scenes', { entity_type: 'scene', scene_id: 'sc1' }),
      folder('f-sh1', 'entity', 'SHOTS/The-Door', 'c-shots', { entity_type: 'shot', shot_id: 'sh1' }),
      folder('f-sh2', 'entity', 'SHOTS/The-Cold-Lamp', 'c-shots', { entity_type: 'shot', shot_id: 'sh2' }),
      folder('f-sh3', 'entity', 'SHOTS/Loose', 'c-shots', { entity_type: 'shot', shot_id: 'sh3' }),
    ],
    managedFiles: [
      managed('m1', 'sh1', 'SHOTS/The-Door/', 'Fixture_plate_v001.exr'),
      managed('m2', 'sh1', 'SHOTS/The-Door/', 'Fixture_board_v001.png'),
      managed('m3', 'sh3', 'SHOTS/Loose/', 'Fixture_loose_v001.mov'),
    ],
    files: [],
  }
}
const at = (root, rel) => path.join(root, ...rel.split('/'))
const write = (root, rel, text = 'x') => { fs.mkdirSync(path.dirname(at(root, rel)), { recursive: true }); fs.writeFileSync(at(root, rel), text) }
const exists = (root, rel) => fs.existsSync(at(root, rel))

let root
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-refile-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

function layOut(bundle) {
  for (const f of bundle.folders) if (f.path) fs.mkdirSync(at(root, f.path), { recursive: true })
  for (const mf of bundle.managedFiles) write(root, mf.folder_path + mf.stored_name, mf.stored_name)
}

describe('ensureEntityFolderRow (S4c)', () => {
  it('a NEW shot in a scene goes under the scene\'s folder, the scene\'s row made first; one with no scene goes under SHOTS', () => {
    const bundle = { project: { id: 'p1', title: 'F', scenes_enabled: true }, scenes: [SC('sc2', 'Cliff path')], shots: [SH('sh9', 'New one', 'sc2'), SH('sh8', 'No scene', null)], folders: [], managedFiles: [] }
    const h = harness(bundle, null)
    const { row } = h.ensureEntityFolderRow(bundle, 'p1', 'shot', bundle.shots[0])
    expect(row.path).toBe('SCENES/Cliff-Path/New-One')
    const scene = bundle.folders.find(f => f.scene_id === 'sc2')
    expect(scene.path).toBe('SCENES/Cliff-Path')
    expect(row.parent_id).toBe(scene.id)
    expect(bundle.folders.map(f => f.path)).not.toContain('SHOTS')
    const loose = h.ensureEntityFolderRow(bundle, 'p1', 'shot', bundle.shots[1]).row
    expect(loose.path).toBe('SHOTS/No-Scene')
    expect(bundle.folders.find(f => f.id === loose.parent_id).path).toBe('SHOTS')
  })
  it('an EXISTING row keeps its parent on a rename: under SHOTS it stays under SHOTS; under its scene it stays there', () => {
    const bundle = fixture()
    const h = harness(bundle, null)
    bundle.shots[0].name = 'The door, wider'
    const kept = h.ensureEntityFolderRow(bundle, 'p1', 'shot', bundle.shots[0]).row
    expect(kept.id).toBe('f-sh1')
    expect(kept.path).toBe('SHOTS/The-Door-Wider')
    expect(kept.parent_id).toBe('c-shots')
    // Nested: a rename moves within the scene's folder.
    const f = bundle.folders.find(x => x.id === 'f-sh2'); f.parent_id = 'f-sc1'; f.path = 'SCENES/Lighthouse-Dawn/The-Cold-Lamp'
    bundle.shots[1].name = 'The warm lamp'
    const moved = h.ensureEntityFolderRow(bundle, 'p1', 'shot', bundle.shots[1]).row
    expect(moved.path).toBe('SCENES/Lighthouse-Dawn/The-Warm-Lamp')
    expect(moved.parent_id).toBe('f-sc1')
    expect(bundle.folders.filter(x => x.shot_id === 'sh2')).toHaveLength(1)
  })
  it('a renamed SCENE takes the rows under it along (its shot folders since S4c): each re-pathed; a shot still under SHOTS is not its descendant (review round 1, item 7)', () => {
    const bundle = fixture()
    const f = bundle.folders.find(x => x.id === 'f-sh2'); f.parent_id = 'f-sc1'; f.path = 'SCENES/Lighthouse-Dawn/The-Cold-Lamp'
    bundle.folders.push(folder('sub', 'custom', 'SCENES/Lighthouse-Dawn/The-Cold-Lamp/plates', 'f-sh2'))
    const h = harness(bundle, null)
    bundle.scenes[0].name = 'Lighthouse, dusk'
    const { row, changed } = h.ensureEntityFolderRow(bundle, 'p1', 'scene', bundle.scenes[0])
    expect([row.id, row.path, changed]).toEqual(['f-sc1', 'SCENES/Lighthouse-Dusk', true])
    expect(bundle.folders.find(x => x.id === 'f-sh2').path).toBe('SCENES/Lighthouse-Dusk/The-Cold-Lamp')
    expect(bundle.folders.find(x => x.id === 'sub').path).toBe('SCENES/Lighthouse-Dusk/The-Cold-Lamp/plates')
    expect(bundle.folders.find(x => x.id === 'f-sh1').path).toBe('SHOTS/The-Door')
    // CONTROL: the same name again changes nothing.
    expect(h.ensureEntityFolderRow(bundle, 'p1', 'scene', bundle.scenes[0]).changed).toBe(false)
  })
})

describe('POST …/folders/refile-shots on a temp root', () => {
  it('moves each pending shot folder with its files, rewrites the records and the row, writes after each shot, keeps SHOTS while a shot has no scene', () => {
    const bundle = fixture()
    layOut(bundle)
    const h = harness(bundle, root)
    const res = h.post()
    expect(res.code).toBe(200)
    expect(res.body.moved.map(m => [m.name, m.from, m.to, m.files, m.missing])).toEqual([
      ['The-Cold-Lamp', 'SHOTS/The-Cold-Lamp', 'SCENES/Lighthouse-Dawn/The-Cold-Lamp', 0, 0],
      ['The-Door', 'SHOTS/The-Door', 'SCENES/Lighthouse-Dawn/The-Door', 2, 0],
    ])
    expect(res.body.left).toEqual([])
    expect(res.body.removedShotsCategory).toBe(false)
    // On disk: the directories and the files are at their new place, nothing at the old.
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr')).toBe(true)
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_board_v001.png')).toBe(true)
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Cold-Lamp')).toBe(true)
    expect(exists(root, 'SHOTS/The-Door')).toBe(false)
    expect(exists(root, 'SHOTS/The-Cold-Lamp')).toBe(false)
    expect(exists(root, 'SHOTS/Loose/Fixture_loose_v001.mov')).toBe(true)
    expect(fs.readFileSync(at(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr'), 'utf8')).toBe('Fixture_plate_v001.exr')
    // The rows: records and folders.
    expect(bundle.managedFiles.map(m => m.folder_path)).toEqual(['SCENES/Lighthouse-Dawn/The-Door/', 'SCENES/Lighthouse-Dawn/The-Door/', 'SHOTS/Loose/'])
    const door = bundle.folders.find(f => f.id === 'f-sh1')
    expect([door.path, door.parent_id]).toEqual(['SCENES/Lighthouse-Dawn/The-Door', 'f-sc1'])
    expect(bundle.folders.find(f => f.id === 'f-sh3').path).toBe('SHOTS/Loose')
    expect(bundle.folders.some(f => f.path === 'SHOTS')).toBe(true)
    // One write per shot moved (resumable), and the answer carries the rows.
    expect(h.writes).toHaveLength(2)
    expect(res.body.folders.map(f => f.path)).toContain('SCENES/Lighthouse-Dawn/The-Door')
    // Idempotent: a second run has nothing to move and changes nothing.
    const again = h.post()
    expect(again.body.moved).toEqual([])
    expect(again.body.left).toEqual([])
    expect(h.writes).toHaveLength(2)
  })

  it('removes the SHOTS category row and its directory only once nothing is left under them, and only when the directory is empty', () => {
    const bundle = fixture()
    bundle.shots = bundle.shots.filter(s => s.id !== 'sh3')
    bundle.folders = bundle.folders.filter(f => f.id !== 'f-sh3')
    bundle.managedFiles = bundle.managedFiles.filter(m => m.shot_id !== 'sh3')
    layOut(bundle)
    // A stray file in SHOTS/ keeps the directory and the row.
    write(root, 'SHOTS/stray.txt')
    let h = harness(bundle, root)
    let res = h.post()
    expect(res.body.moved).toHaveLength(2)
    expect(res.body.removedShotsCategory).toBe(false)
    expect(bundle.folders.some(f => f.path === 'SHOTS')).toBe(true)
    expect(exists(root, 'SHOTS/stray.txt')).toBe(true)
    // The stray gone, a run with nothing pending still tidies the empty category.
    fs.unlinkSync(at(root, 'SHOTS/stray.txt'))
    h = harness(bundle, root)
    res = h.post()
    expect(res.body.moved).toEqual([])
    expect(res.body.removedShotsCategory).toBe(true)
    expect(bundle.folders.some(f => f.path === 'SHOTS')).toBe(false)
    expect(exists(root, 'SHOTS')).toBe(false)
  })

  it('never overwrites: a file already at the destination leaves that shot where it is, with the reason, and the others still move', () => {
    const bundle = fixture()
    layOut(bundle)
    // Something sits where The-Door's plate would land.
    write(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr', 'someone else')
    const h = harness(bundle, root)
    const res = h.post()
    expect(res.body.moved.map(m => m.name)).toEqual(['The-Cold-Lamp'])
    expect(res.body.left).toHaveLength(1)
    expect(res.body.left[0]).toMatchObject({ name: 'The-Door', from: 'SHOTS/The-Door' })
    expect(res.body.left[0].reason).toContain('exists at both')
    // The-Door's rows still say where its files ARE — the board, which the
    // entry-by-entry merge moved before the clash, says its new place; the
    // plate, which did not move, its old — and both plate bodies are intact.
    expect(bundle.folders.find(f => f.id === 'f-sh1').path).toBe('SHOTS/The-Door')
    expect(exists(root, 'SHOTS/The-Door/Fixture_plate_v001.exr')).toBe(true)
    expect(fs.readFileSync(at(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr'), 'utf8')).toBe('someone else')
    expect(bundle.managedFiles.find(m => m.id === 'm1').folder_path).toBe('SHOTS/The-Door/')
    expect(bundle.managedFiles.find(m => m.id === 'm2').folder_path).toBe('SCENES/Lighthouse-Dawn/The-Door/')
    for (const m of bundle.managedFiles.filter(x => x.shot_id === 'sh1')) {
      expect(exists(root, m.folder_path + m.stored_name), m.stored_name).toBe(true)
    }
    // The bundle was written for the failed shot too (its rows are the truth).
    expect(h.writes.length).toBeGreaterThanOrEqual(2)
    // The clash removed, the next run moves what was left (the one file still under SHOTS).
    fs.unlinkSync(at(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr'))
    const h2 = harness(bundle, root)
    const res2 = h2.post()
    expect(res2.body.left).toEqual([])
    expect(res2.body.moved.map(m => [m.name, m.files])).toEqual([['The-Door', 1]])
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_board_v001.png')).toBe(true)
    expect(fs.readFileSync(at(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr'), 'utf8')).toBe('Fixture_plate_v001.exr')
    expect(exists(root, 'SHOTS/The-Door')).toBe(false)
    expect(bundle.managedFiles.filter(x => x.shot_id === 'sh1').map(m => m.folder_path)).toEqual(['SCENES/Lighthouse-Dawn/The-Door/', 'SCENES/Lighthouse-Dawn/The-Door/'])
    expect(bundle.folders.find(f => f.id === 'f-sh1').path).toBe('SCENES/Lighthouse-Dawn/The-Door')
  })

  it('a managed file already missing from disk is counted, not moved, and does not hold its folder back', () => {
    const bundle = fixture()
    layOut(bundle)
    fs.unlinkSync(at(root, 'SHOTS/The-Door/Fixture_board_v001.png'))
    const h = harness(bundle, root)
    const res = h.post()
    const door = res.body.moved.find(m => m.name === 'The-Door')
    expect([door.files, door.missing]).toEqual([2, 1])
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr')).toBe(true)
    expect(bundle.managedFiles.find(m => m.id === 'm2').folder_path).toBe('SCENES/Lighthouse-Dawn/The-Door/')
  })

  it('with no project folder RECORDED and none resolving, the rows alone move — only for a shot with no record under its folder; a shot with records is left with the reason (review round 1, item 2); a scene with no folder row gets one', () => {
    const bundle = fixture()
    bundle.folders = bundle.folders.filter(f => f.id !== 'f-sc1')
    const h = harness(bundle, null)
    const res = h.post()
    expect(res.body.moved.map(m => m.to)).toEqual(['SCENES/Lighthouse-Dawn/The-Cold-Lamp'])
    expect(res.body.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.body.left[0].reason).toBe('2 file records sit under SHOTS/The-Door and no project folder resolves on this computer; nothing was moved')
    const scene = bundle.folders.find(f => f.scene_id === 'sc1')
    expect(scene.path).toBe('SCENES/Lighthouse-Dawn')
    expect(bundle.folders.find(f => f.id === 'f-sh2').parent_id).toBe(scene.id)
    // The door's records and row are exactly as they were.
    expect(bundle.managedFiles.find(m => m.id === 'm1').folder_path).toBe('SHOTS/The-Door/')
    expect(bundle.folders.find(f => f.id === 'f-sh1').path).toBe('SHOTS/The-Door')
    // With no directory to look at, the ROWS alone decide whether SHOTS may
    // go: Loose (no scene) and The-Door still sit under it, so it stays.
    expect(res.body.removedShotsCategory).toBe(false)
    expect(bundle.folders.some(f => f.kind === 'category' && f.path === 'SHOTS')).toBe(true)
    // …and once nothing is under it, the row goes, with no disk involved.
    bundle.shots = bundle.shots.filter(s => s.id === 'sh2')
    bundle.folders = bundle.folders.filter(f => !['f-sh1', 'f-sh3'].includes(f.id))
    bundle.managedFiles = []
    const again = harness(bundle, null).post()
    expect(again.body.removedShotsCategory).toBe(true)
    expect(bundle.folders.some(f => f.path === 'SHOTS')).toBe(false)
  })

  it('a project folder RECORDED (folder_root) that this computer cannot reach refuses every shot, records or not: nothing moves', () => {
    const bundle = fixture()
    bundle.project.folder_root = 'Z:\\gone\\Fixture'
    // resolveProjectFolder answers null here: the root does not exist on this machine.
    const h = harness(bundle, null)
    const res = h.post()
    expect(res.body.moved).toEqual([])
    expect(res.body.left.map(l => l.name)).toEqual(['The-Cold-Lamp', 'The-Door'])
    for (const l of res.body.left) expect(l.reason).toBe('the project folder (Z:\\gone\\Fixture) cannot be reached from this computer; nothing was moved')
    expect(bundle.folders.find(f => f.id === 'f-sh2').path).toBe('SHOTS/The-Cold-Lamp')
    expect(bundle.managedFiles.map(m => m.folder_path)).toEqual(['SHOTS/The-Door/', 'SHOTS/The-Door/', 'SHOTS/Loose/'])
    expect(res.body.removedShotsCategory).toBe(false)
  })

  it('a file that was on disk and is not at its new place after the move is reported, every record that DID arrive already saying so; the next run finishes the folder', () => {
    const bundle = fixture()
    layOut(bundle)
    // A rename that loses the board on the way (the directory moved whole).
    const fsBroken = { ...fs, renameSync: (s, d) => { fs.renameSync(s, d); if (d.endsWith('The-Door')) fs.unlinkSync(path.join(d, 'Fixture_board_v001.png')) } }
    const h = harness(bundle, root, fsBroken)
    const res = h.post()
    expect(res.body.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.body.left[0].reason).toBe('“Fixture_board_v001.png” did not arrive at SCENES/Lighthouse-Dawn/The-Door (its record was moved)')
    // The plate arrived and its record says so — retargeted the moment the
    // directory moved, not after a verification that never came.
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr')).toBe(true)
    expect(bundle.managedFiles.find(m => m.id === 'm1').folder_path).toBe('SCENES/Lighthouse-Dawn/The-Door/')
    expect(bundle.folders.find(f => f.id === 'f-sh1').path).toBe('SHOTS/The-Door')
    expect(h.writes.length).toBeGreaterThanOrEqual(2)
    // The next run: the directory is already there, nothing is under the old
    // path, the folder row goes under the scene.
    const res2 = harness(bundle, root).post()
    expect(res2.body.left).toEqual([])
    expect(res2.body.moved.map(m => [m.name, m.files, m.missing])).toEqual([['The-Door', 0, 0]])
    expect(bundle.folders.find(f => f.id === 'f-sh1').path).toBe('SCENES/Lighthouse-Dawn/The-Door')
  })

  it('a folder row already at the destination refuses the shot before anything moves', () => {
    const bundle = fixture()
    layOut(bundle)
    bundle.folders.push(folder('custom', 'custom', 'SCENES/Lighthouse-Dawn/The-Door', 'f-sc1'))
    const h = harness(bundle, root)
    const res = h.post()
    expect(res.body.left.map(l => [l.name, l.reason])).toEqual([['The-Door', 'a folder already sits at SCENES/Lighthouse-Dawn/The-Door']])
    expect(exists(root, 'SHOTS/The-Door/Fixture_plate_v001.exr')).toBe(true)
    expect(bundle.managedFiles.find(m => m.id === 'm1').folder_path).toBe('SHOTS/The-Door/')
    expect(res.body.moved.map(m => m.name)).toEqual(['The-Cold-Lamp'])
  })

  it('rows under the shot folder follow it; in a merge, a record under a moved sub-directory says its new place before a later clash', () => {
    const bundle = fixture()
    bundle.folders.push(folder('sub', 'custom', 'SHOTS/The-Door/plates', 'f-sh1'))
    bundle.managedFiles.push(managed('m4', 'sh1', 'SHOTS/The-Door/plates/', 'Fixture_plate_v002.exr'))
    bundle.managedFiles.push(managed('m5', 'sh1', 'SHOTS/The-Door/', 'zz_last.txt'))
    layOut(bundle)
    // The destination exists (a merge, entry by entry in name order), and the LAST entry clashes.
    write(root, 'SCENES/Lighthouse-Dawn/The-Door/zz_last.txt', 'someone else')
    const h = harness(bundle, root)
    const res = h.post()
    expect(res.body.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.body.left[0].reason).toContain('“zz_last.txt” exists at both')
    // Moved before the clash: the two files and the sub-directory — and the
    // record UNDER the sub-directory says so (round 1, item 12: only direct
    // children were retargeted in the loop).
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Door/plates/Fixture_plate_v002.exr')).toBe(true)
    expect(bundle.managedFiles.find(m => m.id === 'm4').folder_path).toBe('SCENES/Lighthouse-Dawn/The-Door/plates/')
    expect(bundle.managedFiles.find(m => m.id === 'm1').folder_path).toBe('SCENES/Lighthouse-Dawn/The-Door/')
    expect(bundle.managedFiles.find(m => m.id === 'm5').folder_path).toBe('SHOTS/The-Door/')
    expect(exists(root, 'SHOTS/The-Door/zz_last.txt')).toBe(true)
    // The folder rows move only when the folder's own row does.
    expect(bundle.folders.find(f => f.id === 'sub').path).toBe('SHOTS/The-Door/plates')
    // The clash removed: the next run finishes — the row under the folder re-pathed with it.
    fs.unlinkSync(at(root, 'SCENES/Lighthouse-Dawn/The-Door/zz_last.txt'))
    const res2 = harness(bundle, root).post()
    expect(res2.body.left).toEqual([])
    expect(bundle.folders.find(f => f.id === 'sub').path).toBe('SCENES/Lighthouse-Dawn/The-Door/plates')
    expect(bundle.managedFiles.find(m => m.id === 'm5').folder_path).toBe('SCENES/Lighthouse-Dawn/The-Door/')
    expect(fs.readFileSync(at(root, 'SCENES/Lighthouse-Dawn/The-Door/zz_last.txt'), 'utf8')).toBe('zz_last.txt')
    expect(exists(root, 'SHOTS/The-Door')).toBe(false)
  })

  it('a directory already at its new place with records still saying the old (an earlier run that never wrote the bundle) is counted done; nothing moves', () => {
    const bundle = fixture()
    layOut(bundle)
    fs.renameSync(at(root, 'SHOTS/The-Door'), at(root, 'SCENES/Lighthouse-Dawn/The-Door'))
    const h = harness(bundle, root)
    const res = h.post()
    expect(res.body.left).toEqual([])
    const door = res.body.moved.find(m => m.name === 'The-Door')
    expect([door.files, door.missing]).toEqual([2, 0])
    expect(bundle.managedFiles.filter(m => m.shot_id === 'sh1').map(m => m.folder_path)).toEqual(['SCENES/Lighthouse-Dawn/The-Door/', 'SCENES/Lighthouse-Dawn/The-Door/'])
    expect(bundle.folders.find(f => f.id === 'f-sh1').path).toBe('SCENES/Lighthouse-Dawn/The-Door')
    expect(exists(root, 'SCENES/Lighthouse-Dawn/The-Door/Fixture_plate_v001.exr')).toBe(true)
  })

  it('CONTROL: a project with nothing under SHOTS answers an empty move and writes nothing', () => {
    const bundle = fixture()
    bundle.folders = bundle.folders.filter(f => !f.path.startsWith('SHOTS'))
    bundle.managedFiles = []
    const h = harness(bundle, root)
    const res = h.post()
    expect(res.body).toMatchObject({ moved: [], left: [], removedShotsCategory: false })
    expect(h.writes).toHaveLength(0)
  })
})

// ── The managed-files POST: a record's folder_path from the entity's row ─────
// Lifted the same way. A scene's, a shot's, a level's or an experience's
// record names the folder its row has (a shot's inside its scene's, or
// under SHOTS while un-refiled); a level's and an experience's carry their
// links and version among themselves; an asset's keeps its own slug.
const MANAGED_ROUTE = '/api/rabbit/projects/:projectId/managed-files'
function managedHarness(bundle) {
  const routes = new Map()
  const writes = []
  const expressApp = { post: (pattern, h) => routes.set(pattern, h) }
  let seq = 0
  // eslint-disable-next-line no-new-func
  new Function(
    'fs', 'path', 'uuidv4', 'resolveContainedFilePath', 'resolveProjectFolder', 'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'expressApp',
    `${extractFunction(MAIN_CJS, 'fileSlugify')}
     ${extractFunction(MAIN_CJS, 'getNextVersion')}
     ${extractFunction(MAIN_CJS, 'formatVersion')}
     ${extractFunction(MAIN_CJS, 'safeExtension')}
     const FOLDER_CATEGORIES = ${extractArrayLiteral(MAIN_CJS, 'FOLDER_CATEGORIES')};
     const FOLDER_ENTITY_FK = ${extractObjectLiteral(MAIN_CJS, 'FOLDER_ENTITY_FK')};
     const FOLDER_FALLBACK_NAME = ${extractObjectLiteral(MAIN_CJS, 'FOLDER_FALLBACK_NAME')};
     ${extractFunction(MAIN_CJS, 'slugOrFallback')}
     ${extractFunction(MAIN_CJS, 'planProjectFolderList')}
     ${extractFunction(MAIN_CJS, 'planEntityFolderFor')}
     ${extractFunction(MAIN_CJS, 'sceneOfShot')}
     ${extractFunction(MAIN_CJS, 'addFolderRow')}
     ${extractFunction(MAIN_CJS, 'materializeFolderDirs')}
     ${extractFunction(MAIN_CJS, 'ensureProjectFolderRows')}
     ${extractFunction(MAIN_CJS, 'ensureEntityFolderRow')}
     ${extractRoute(MAIN_CJS, MANAGED_ROUTE)}`,
  )(fs, path, () => `uuid-${++seq}`, resolveContainedFilePath, () => null, () => bundle, (_id, b) => writes.push(structuredClone(b)), (res) => res.status(404).json({ error: 'not found' }), expressApp)
  const post = (body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    routes.get(MANAGED_ROUTE)({ params: { projectId: 'p1' }, body }, res)
    return res
  }
  return { post, writes }
}

describe('POST …/managed-files files a record where the entity\'s folder row says (S4c)', () => {
  const base = { file_name: 'plate', original_name: 'plate.exr', extension: '.exr', size_bytes: 1 }
  it('a shot in its scene (no row yet): SCENES/<scene>/<shot>/, the row made first; a shot still under SHOTS keeps SHOTS/<shot>/', () => {
    const bundle = fixture()
    bundle.folders = bundle.folders.filter(f => f.id !== 'f-sh2')
    const h = managedHarness(bundle)
    const nested = h.post({ ...base, shot_id: 'sh2' })
    expect(nested.code).toBe(200)
    expect(nested.body.folder_path).toBe('SCENES/Lighthouse-Dawn/The-Cold-Lamp/')
    expect(nested.body.shot_id).toBe('sh2')
    expect(bundle.folders.find(f => f.shot_id === 'sh2').parent_id).toBe('f-sc1')
    const legacy = h.post({ ...base, shot_id: 'sh1' })
    expect(legacy.body.folder_path).toBe('SHOTS/The-Door/')
  })
  it('a level and an experience: LEVELS/<slug>/ and EXPERIENCES/<slug>/, their links on the row, versions among their own', () => {
    const bundle = fixture()
    bundle.project.levels_enabled = true
    bundle.levels = [{ id: 'l1', name: 'Lamp Room' }]
    bundle.experiences = [{ id: 'x1', name: 'The Storm' }]
    const h = managedHarness(bundle)
    const l1 = h.post({ ...base, level_id: 'l1' })
    expect(l1.body).toMatchObject({ folder_path: 'LEVELS/Lamp-Room/', level_id: 'l1', experience_id: null, shot_id: null, version: 1, version_label: 'v001' })
    const l2 = h.post({ ...base, level_id: 'l1' })
    expect(l2.body.version_label).toBe('v002')
    const x1 = h.post({ ...base, experience_id: 'x1' })
    expect(x1.body).toMatchObject({ folder_path: 'EXPERIENCES/The-Storm/', experience_id: 'x1', level_id: null, version: 1 })
    expect(bundle.folders.some(f => f.path === 'LEVELS')).toBe(true)
    expect(bundle.folders.find(f => f.level_id === 'l1').path).toBe('LEVELS/Lamp-Room')
    expect(bundle.managedFiles).toHaveLength(6)
  })
  it('a missing entity is 404 and writes no record; an asset keeps its own slug', () => {
    const bundle = fixture()
    bundle.assets = [{ id: 'a1', name: 'Hero', folder_slug: 'Hero-Kept' }]
    const h = managedHarness(bundle)
    expect(h.post({ ...base, level_id: 'nope' }).code).toBe(404)
    expect(bundle.managedFiles).toHaveLength(3)
    expect(h.post({ ...base, asset_id: 'a1' }).body.folder_path).toBe('ASSETS/Hero-Kept/')
  })
})

describe('(the harness itself)', () => {
  it('lifts the route by paren matching, not by a guess at its length', () => {
    const bundle = fixture()
    bundle.folders = bundle.folders.filter(f => !f.path.startsWith('SHOTS'))
    bundle.managedFiles = []
    const h = harness(bundle, root)
    const res = h.post()
    expect(res.body).toMatchObject({ moved: [], left: [], removedShotsCategory: false })
    expect(h.writes).toHaveLength(0)
  })
})
