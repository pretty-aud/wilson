// =============================================================================
// localDemoRoot.test.js — demo sprint, 2026-09-10.
//
// The local demo folder (electron/localDemoRoot.cjs): the adopt / initialise
// / ask rule, the per-machine pointer with its recent list, and the root
// resolution main.cjs's getRabbitDataDir() / resolveConfiguredRootDir() ride
// — folder open, folder not open, remembered folder missing, containment.
//
// The stateful half runs against REAL temporary directories rather than a
// fake fs: the questions here ("was the manifest written", "is the pointer
// on disk", "did a foreign folder stay untouched") are exactly the ones a
// fake would answer by construction. The pure shape check is exercised with
// path.win32 AND path.posix injected, the way pathContainment.test.js does,
// because CI runs on ubuntu and the demo may run on a Mac laptop.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('../../electron/localDemoRoot.cjs')
const {
  MANIFEST_NAME, MANIFEST_FORMAT, MANIFEST_KIND, POINTER_NAME, RECENT_LIMIT,
  layoutFor, newManifest, checkDemoFolderShape, classifyFolder,
  normalizePointer, withRecent, withoutRecent, makeLocalDemoRoot,
} = mod

// ── the pure rule ────────────────────────────────────────────────────────────

describe('classifyFolder — adopt / initialise / ask', () => {
  it('a folder with a current manifest is a WILSON folder (adopt)', () => {
    expect(classifyFolder(['projects', '.wilson'], { format: 1 }).kind).toBe('wilson')
  })
  it('a manifest from a newer WILSON is refused, not adopted', () => {
    const r = classifyFolder([], { format: MANIFEST_FORMAT + 1 })
    expect(r.kind).toBe('newer')
    expect(r.format).toBe(MANIFEST_FORMAT + 1)
  })
  it('a manifest without an integer format is corrupt (ask)', () => {
    expect(classifyFolder([], { format: 'one' }).kind).toBe('corrupt')
    expect(classifyFolder([], 'corrupt').kind).toBe('corrupt')
  })
  it('nothing but OS litter is empty (initialise)', () => {
    expect(classifyFolder([], null).kind).toBe('empty')
    expect(classifyFolder(['desktop.ini', 'Thumbs.db', '.DS_Store'], null).kind).toBe('empty')
  })
  it("somebody's files with no manifest is foreign (ask), with a preview", () => {
    const names = Array.from({ length: 20 }, (_, i) => `clip-${i}.mov`)
    const r = classifyFolder(names, null)
    expect(r.kind).toBe('foreign')
    expect(r.count).toBe(20)
    expect(r.entries).toHaveLength(12)
  })
})

describe('checkDemoFolderShape — relative, root and device paths are refused', () => {
  it('win32: drive and UNC folders pass in canonical form', () => {
    expect(checkDemoFolderShape('D:\\Demos\\wilson\\', path.win32)).toEqual({ ok: true, resolved: 'D:\\Demos\\wilson' })
    expect(checkDemoFolderShape('\\\\nas\\share\\demo', path.win32)).toEqual({ ok: true, resolved: '\\\\nas\\share\\demo' })
  })
  it('win32: a drive root, a bare share, a device path and a relative path are refused', () => {
    expect(checkDemoFolderShape('C:\\', path.win32).ok).toBe(false)
    expect(checkDemoFolderShape('\\\\nas\\share', path.win32).ok).toBe(false)
    expect(checkDemoFolderShape('\\\\?\\C:\\x', path.win32).ok).toBe(false)
    expect(checkDemoFolderShape('demos\\wilson', path.win32).ok).toBe(false)
    expect(checkDemoFolderShape('', path.win32).ok).toBe(false)
    expect(checkDemoFolderShape(null, path.win32).ok).toBe(false)
  })
  it('three or more leading separators are refused, not rebased onto the process drive (review 1, N13)', () => {
    const four = '\\'.repeat(4)
    expect(checkDemoFolderShape(four + 'nas\\share\\demo', path.win32).ok).toBe(false)
    expect(checkDemoFolderShape(four + '?\\C:\\x', path.win32).ok).toBe(false)
    expect(checkDemoFolderShape('///tmp/demo', path.posix).ok).toBe(false)
  })
  it('posix: an absolute folder passes, the filesystem root and a relative path do not', () => {
    expect(checkDemoFolderShape('/Users/audrey/Demos/', path.posix)).toEqual({ ok: true, resolved: '/Users/audrey/Demos' })
    expect(checkDemoFolderShape('/', path.posix).ok).toBe(false)
    expect(checkDemoFolderShape('Demos/wilson', path.posix).ok).toBe(false)
  })
})

describe('the pointer file — normalisation and the recent list', () => {
  it('garbage normalises to an empty pointer', () => {
    expect(normalizePointer(null)).toEqual({ activeFolder: null, recent: [] })
    expect(normalizePointer('x')).toEqual({ activeFolder: null, recent: [] })
    expect(normalizePointer({ activeFolder: 3, recent: 'no' })).toEqual({ activeFolder: null, recent: [] })
  })
  it('dedupes case-insensitively and caps the list', () => {
    const recent = Array.from({ length: RECENT_LIMIT + 4 }, (_, i) => ({ path: path.resolve(`demo-${i}`) }))
    recent.push({ path: path.resolve('DEMO-0') })
    const p = normalizePointer({ recent })
    expect(p.recent).toHaveLength(RECENT_LIMIT)
    expect(p.recent[0].path).toBe(path.resolve('demo-0'))
  })
  it('withRecent moves a folder to the front once; withoutRecent removes it', () => {
    const a = path.resolve('a'), b = path.resolve('b')
    let p = normalizePointer({ recent: [{ path: a }, { path: b }] })
    p = withRecent(p, b, '2026-09-10T00:00:00Z')
    expect(p.recent.map(r => r.path)).toEqual([b, a])
    expect(p.recent[0].lastOpened).toBe('2026-09-10T00:00:00Z')
    p = withRecent(p, b.toUpperCase(), '2026-09-11T00:00:00Z')
    expect(p.recent).toHaveLength(2)
    p = withoutRecent(p, a)
    expect(p.recent.map(r => r.path)).toEqual([b.toUpperCase()])
  })
  it('newManifest records the format, kind, creation and app version', () => {
    const m = newManifest({ appVersion: '1.0.0', now: 'T' })
    expect(m).toMatchObject({ format: MANIFEST_FORMAT, kind: MANIFEST_KIND, created_at: 'T', created_with: '1.0.0', last_opened_at: 'T' })
  })
})

// ── the stateful root, against real temp folders ────────────────────────────

describe('makeLocalDemoRoot — root resolution and the folder lifecycle', () => {
  let base, userData, tick
  const now = () => `2026-09-10T00:00:${String(tick++).padStart(2, '0')}.000Z`
  const make = (extra = {}) => makeLocalDemoRoot({ userDataDir: userData, appVersion: '1.0.0', now, ...extra })
  const folder = (name) => { const p = path.join(base, name); mkdirSync(p, { recursive: true }); return p }

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'wilson-local-demo-'))
    userData = path.join(base, 'userData')
    mkdirSync(userData)
    tick = 0
  })
  afterEach(() => { rmSync(base, { recursive: true, force: true }) })

  it('with no folder open every root question answers null, and load() is a no-op', () => {
    const root = make()
    const state = root.load()
    expect(state).toMatchObject({ active: null, missing: null, recent: [] })
    expect(root.rootDir()).toBeNull()
    expect(root.dataDir()).toBeNull()
    expect(root.projectsDir()).toBeNull()
    expect(root.contains(base)).toBe(false)
    expect(existsSync(path.join(userData, POINTER_NAME))).toBe(false)
  })

  it('opening an EMPTY folder initialises it: manifest, layout, pointer, roots', () => {
    const root = make()
    const dir = folder('fresh')
    const r = root.open(dir)
    expect(r).toMatchObject({ ok: true, status: 'initialised', folder: dir })
    const layout = layoutFor(dir)
    expect(existsSync(layout.manifestPath)).toBe(true)
    expect(existsSync(layout.dataDir)).toBe(true)
    expect(existsSync(layout.projectsDir)).toBe(true)
    const manifest = JSON.parse(readFileSync(layout.manifestPath, 'utf8'))
    expect(manifest).toMatchObject({ format: MANIFEST_FORMAT, kind: MANIFEST_KIND, created_with: '1.0.0' })
    // the three questions main.cjs asks
    expect(root.rootDir()).toBe(dir)
    expect(root.dataDir()).toBe(path.join(dir, '.wilson', 'rabbit-data'))
    expect(root.projectsDir()).toBe(path.join(dir, 'projects'))
    expect(root.contains(path.join(dir, 'projects', 'x'))).toBe(true)
    expect(root.contains(path.join(base, 'elsewhere'))).toBe(false)
    // remembered per machine
    const pointer = JSON.parse(readFileSync(path.join(userData, POINTER_NAME), 'utf8'))
    expect(pointer.activeFolder).toBe(dir)
    expect(pointer.recent[0].path).toBe(dir)
  })

  it('a folder that already IS a demo folder is ADOPTED, never reinitialised', () => {
    const dir = folder('carried')
    const first = make()
    first.open(dir)
    const created = JSON.parse(readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'))
    // a project bundle "inside" it must survive the second open untouched
    const bundle = path.join(dir, '.wilson', 'rabbit-data', 'projects', 'p1', 'project.json')
    mkdirSync(path.dirname(bundle), { recursive: true })
    writeFileSync(bundle, '{"project":{"id":"p1"}}')

    const second = make()
    const r = second.open(dir)
    expect(r).toMatchObject({ ok: true, status: 'adopted' })
    const after = JSON.parse(readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'))
    expect(after.created_at).toBe(created.created_at)
    expect(after.last_opened_at).not.toBe(created.last_opened_at)
    expect(readFileSync(bundle, 'utf8')).toBe('{"project":{"id":"p1"}}')
  })

  it('a folder holding OTHER files asks first and writes nothing; confirmed, it keeps them', () => {
    const root = make()
    const dir = folder('photos')
    writeFileSync(path.join(dir, 'IMG_0001.jpg'), 'x')
    writeFileSync(path.join(dir, 'notes.txt'), 'y')
    const ask = root.open(dir)
    expect(ask).toMatchObject({ ok: false, needsConfirm: true, kind: 'foreign', count: 2 })
    expect(ask.entries).toEqual(expect.arrayContaining(['IMG_0001.jpg', 'notes.txt']))
    expect(existsSync(path.join(dir, MANIFEST_NAME))).toBe(false)
    expect(existsSync(path.join(dir, '.wilson'))).toBe(false)
    expect(root.rootDir()).toBeNull()

    const yes = root.open(dir, { allowForeign: true })
    expect(yes).toMatchObject({ ok: true, status: 'initialised' })
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(['IMG_0001.jpg', 'notes.txt', MANIFEST_NAME, 'projects', '.wilson']))
  })

  it('a damaged manifest asks; a manifest from a newer WILSON is refused outright', () => {
    const root = make()
    const bad = folder('damaged')
    writeFileSync(path.join(bad, MANIFEST_NAME), '{not json')
    expect(root.open(bad)).toMatchObject({ ok: false, needsConfirm: true, kind: 'corrupt' })
    expect(root.open(bad, { allowForeign: true })).toMatchObject({ ok: true, status: 'initialised' })

    const newer = folder('future')
    writeFileSync(path.join(newer, MANIFEST_NAME), JSON.stringify({ format: MANIFEST_FORMAT + 1 }))
    const r = make().open(newer)
    expect(r.ok).toBe(false)
    expect(r.needsConfirm).toBeUndefined()
    expect(r.error).toMatch(/newer WILSON/)
  })

  it('shape refusals: a relative path, a missing folder and a file are not opened', () => {
    const root = make()
    expect(root.open('relative/demo').ok).toBe(false)
    expect(root.open(path.join(base, 'nope')).ok).toBe(false)
    const file = path.join(base, 'a-file.txt')
    writeFileSync(file, 'x')
    expect(root.open(file).ok).toBe(false)
    expect(root.rootDir()).toBeNull()
  })

  it('the next launch re-opens the remembered folder', () => {
    const dir = folder('remembered')
    make().open(dir)
    const next = make()
    const state = next.load()
    expect(state.active).toBe(dir)
    expect(state.missing).toBeNull()
    expect(next.dataDir()).toBe(path.join(dir, '.wilson', 'rabbit-data'))
    expect(state.manifest.format).toBe(MANIFEST_FORMAT)
  })

  it('a remembered folder that is gone (drive unplugged) is reported MISSING, never replaced by userData', () => {
    const dir = folder('on-the-drive')
    make().open(dir)
    rmSync(dir, { recursive: true, force: true })
    const next = make()
    const state = next.load()
    expect(state.active).toBeNull()
    expect(state.missing).toBe(dir)
    expect(next.dataDir()).toBeNull()
    expect(next.projectsDir()).toBeNull()
    // the pointer still names it, so "locate it" has something to locate
    expect(JSON.parse(readFileSync(path.join(userData, POINTER_NAME), 'utf8')).activeFolder).toBe(dir)
    expect(next.isKnownFolder(dir)).toBe(true)
  })

  it('close() returns to app data but keeps the folder in the recent list', () => {
    const root = make()
    const dir = folder('closing')
    root.open(dir)
    const state = root.close()
    expect(state.active).toBeNull()
    expect(root.dataDir()).toBeNull()
    expect(state.recent.map(r => r.path)).toEqual([dir])
    expect(JSON.parse(readFileSync(path.join(userData, POINTER_NAME), 'utf8')).activeFolder).toBeNull()
  })

  it('forget() drops a folder from the list and clears a missing one; the open folder is refused', () => {
    const root = make()
    const a = folder('a'), b = folder('b')
    root.open(a)
    root.open(b)
    expect(root.forget(b)).toMatchObject({ ok: false })
    expect(root.forget(a).ok).toBe(true)
    expect(root.getState().recent.map(r => r.path)).toEqual([b])
    expect(root.isKnownFolder(a)).toBe(false)
    expect(root.isKnownFolder(b)).toBe(true)

    rmSync(b, { recursive: true, force: true })
    const next = make()
    expect(next.load().missing).toBe(b)
    expect(next.forget(b).ok).toBe(true)
    expect(next.getState()).toMatchObject({ active: null, missing: null, recent: [] })
  })

  it('reset() empties projects/ and .wilson/rabbit-data and NOTHING else; refused with no folder open', () => {
    const root = make()
    expect(root.reset()).toMatchObject({ ok: false })

    const dir = folder('with-stuff')
    writeFileSync(path.join(dir, 'IMG_0001.jpg'), 'keep me')
    root.open(dir, { allowForeign: true })
    const layout = layoutFor(dir)
    // WILSON content that must go
    mkdirSync(path.join(layout.projectsDir, 'Friday-Demo', 'ASSETS'), { recursive: true })
    writeFileSync(path.join(layout.projectsDir, 'Friday-Demo', 'ASSETS', 'a.txt'), 'x')
    mkdirSync(path.join(layout.dataDir, 'projects', 'p1'), { recursive: true })
    writeFileSync(path.join(layout.dataDir, 'projects', 'p1', 'project.json'), '{}')
    mkdirSync(path.join(layout.dataDir, 'thumbnails'), { recursive: true })
    // things beside it that must survive
    writeFileSync(path.join(dir, '.wilson', 'notes.txt'), 'mine')
    const before = JSON.parse(readFileSync(layout.manifestPath, 'utf8'))

    const r = root.reset()
    expect(r.ok).toBe(true)
    expect(r.removed).toEqual([layout.projectsDir, layout.dataDir])
    expect(readdirSync(layout.projectsDir)).toEqual([])
    expect(readdirSync(layout.dataDir)).toEqual([])
    expect(readFileSync(path.join(dir, 'IMG_0001.jpg'), 'utf8')).toBe('keep me')
    expect(readFileSync(path.join(dir, '.wilson', 'notes.txt'), 'utf8')).toBe('mine')
    const after = JSON.parse(readFileSync(layout.manifestPath, 'utf8'))
    expect(after.created_at).toBe(before.created_at)
    expect(typeof after.last_reset_at).toBe('string')
    // still open, same roots
    expect(root.rootDir()).toBe(dir)
    expect(root.dataDir()).toBe(layout.dataDir)
  })

  it('records which layout directories WILSON itself created (review 1, H2)', () => {
    const empty = folder('empty')
    make().open(empty)
    expect(JSON.parse(readFileSync(path.join(empty, MANIFEST_NAME), 'utf8')).created_layout)
      .toEqual({ projects: true, rabbit_data: true })

    const theirs = folder('theirs')
    mkdirSync(path.join(theirs, 'projects', 'ClientA'), { recursive: true })
    make().open(theirs, { allowForeign: true })
    expect(JSON.parse(readFileSync(path.join(theirs, MANIFEST_NAME), 'utf8')).created_layout)
      .toEqual({ projects: false, rabbit_data: true })
  })

  it('reset() REFUSES when projects/ existed before WILSON opened the folder, and touches nothing (review 1, H2)', () => {
    const root = make()
    const dir = folder('theirs')
    mkdirSync(path.join(dir, 'projects', 'ClientA'), { recursive: true })
    writeFileSync(path.join(dir, 'projects', 'ClientA', 'cut.txt'), 'their work')
    root.open(dir, { allowForeign: true })
    const layout = layoutFor(dir)
    mkdirSync(path.join(layout.dataDir, 'projects', 'p1'), { recursive: true })
    writeFileSync(path.join(layout.dataDir, 'projects', 'p1', 'project.json'), '{}')

    const r = root.reset()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/existed before WILSON opened this folder/)
    expect(readFileSync(path.join(dir, 'projects', 'ClientA', 'cut.txt'), 'utf8')).toBe('their work')
    // nothing at all was removed — not even WILSON's own data, because the
    // check runs before any delete
    expect(existsSync(path.join(layout.dataDir, 'projects', 'p1', 'project.json'))).toBe(true)
  })

  it('reset() refuses when a manifest carries no provenance (an older WILSON)', () => {
    const root = make()
    const dir = folder('older')
    writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify({ format: MANIFEST_FORMAT, kind: MANIFEST_KIND }))
    expect(root.open(dir)).toMatchObject({ ok: true, status: 'adopted' })
    expect(root.reset()).toMatchObject({ ok: false })
  })

  it('a folder opened through a link is stored by its REAL path, and reset() refuses a linked subtree (review 1, M7)', () => {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    // the folder itself, reached through a link
    const real = folder('real-demo')
    const link = path.join(base, 'demo-link')
    symlinkSync(real, link, linkType)
    const viaLink = make()
    expect(viaLink.open(link)).toMatchObject({ ok: true })
    expect(viaLink.rootDir().toLowerCase()).toBe(realpathSync.native(real).toLowerCase())

    // a `.wilson` link planted inside an open folder AFTER it was initialised
    // (so provenance says WILSON made both directories — review 2, M5 now
    // refuses a pre-existing .wilson on its own), pointing at a victim
    const victim = folder('victim')
    mkdirSync(path.join(victim, 'rabbit-data'), { recursive: true })
    writeFileSync(path.join(victim, 'rabbit-data', 'secret.txt'), 'must survive')
    const planted = folder('planted')
    const root = make()
    expect(root.open(planted)).toMatchObject({ ok: true, status: 'initialised' })
    rmSync(path.join(planted, '.wilson'), { recursive: true, force: true })
    symlinkSync(victim, path.join(planted, '.wilson'), linkType)
    const r = root.reset()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/points outside the demo folder/)
    expect(readFileSync(path.join(victim, 'rabbit-data', 'secret.txt'), 'utf8')).toBe('must survive')
    // and the first target was NOT deleted ahead of the refusal
    expect(existsSync(path.join(planted, 'projects'))).toBe(true)
  })

  it('switching folders keeps both in the recent list, newest first, and moves the roots', () => {
    const root = make()
    const a = folder('first'), b = folder('second')
    root.open(a)
    root.open(b)
    expect(root.getState().recent.map(r => r.path)).toEqual([b, a])
    expect(root.dataDir()).toBe(path.join(b, '.wilson', 'rabbit-data'))
    root.open(a)
    expect(root.getState().recent.map(r => r.path)).toEqual([a, b])
    expect(root.dataDir()).toBe(path.join(a, '.wilson', 'rabbit-data'))
  })
})
