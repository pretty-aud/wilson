// =============================================================================
// jsonFile.test.js — F3 (wave 1 of docs/sessions/PLAN_WEEK_2026-11-04.md;
// OUTSTANDING REV-06, REV-07): electron/jsonFile.cjs run for real on
// temporary folders, then main.cjs's use of it, lifted by brace matching (the
// house technique) and run over real folders with a counting `fs`:
//
//   1. one atomic writer (a planted lock, a planted crash, a power-cut sync);
//   2. the kept bundles (a stamp per file; a hand edit, a copy, a delete);
//   3. mirrors written only when they change, or are gone from the folder;
//   4. readRabbitBundle / writeRabbitBundle: a kept read does not touch the
//      file; a write keeps what a read of it would give (a title that
//      slugifies to nothing); a failed write keeps nothing;
//   5. the subjects GET writes nothing, the writes keep the order;
//   6. the project PATCH makes the five sub-folders; every JSON write in
//      main.cjs and localDemoRoot.cjs is the one writer; the 50 MB limit.
//
// Each with a failing control: the same assertion run against the tip's code
// (kept below as text, from 796399cf) or a writer without the rule.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import realFs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {
  readJson, writeTextAtomic, writeJsonAtomic, createKeptFiles, createChangeOnlyWriter, WRITE_ATTEMPTS,
} = require('../../electron/jsonFile.cjs')
const { backfillShotListsOnRead, ensureShotListKeys, pruneDanglingShotListItems } = require('../../electron/rabbitShotLists.cjs')
const rabbitTaskItems = require('../../electron/rabbitTaskItems.cjs')
const rabbitTableViews = require('../../electron/rabbitTableViews.cjs')
const { isPathInside } = require('../../electron/pathContainment.cjs')

const MAIN = realFs.readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf-8')
const DEMO = realFs.readFileSync(new URL('../../electron/localDemoRoot.cjs', import.meta.url), 'utf-8')

/** The whole `function <name>(…) { … }`, by brace matching. */
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
/** The BODY block of an inline `expressApp.<verb>('<path>', (req, res) => { … })`. */
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

/** Real fs, every call counted by method; `plant[method]` replaces one. */
function countingFs(plant = {}) {
  const counts = {}
  const fsImpl = new Proxy(realFs, {
    get(target, key) {
      const v = target[key]
      if (typeof v !== 'function') return v
      return (...args) => {
        counts[key] = (counts[key] || 0) + 1
        if (plant[key]) return plant[key](v.bind(target), ...args)
        return v.apply(target, args)
      }
    },
  })
  return { fs: fsImpl, counts, reset: () => { for (const k of Object.keys(counts)) delete counts[k] } }
}
const locked = (code = 'EBUSY') => Object.assign(new Error(`${code}: resource busy or locked`), { code })

let dir
beforeEach(() => { dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'wilson-f3-')) })
afterEach(() => { realFs.rmSync(dir, { recursive: true, force: true }) })

// ── 1. One writer ────────────────────────────────────────────────────────────
describe('writeTextAtomic / writeJsonAtomic — whole, renamed into place, retried while Windows holds the file', () => {
  it('writes two-space JSON whole, returns the text, leaves no .tmp', () => {
    const file = path.join(dir, 'a.json')
    const text = writeJsonAtomic(file, { a: 1, b: [2] })
    expect(text).toBe(JSON.stringify({ a: 1, b: [2] }, null, 2))
    expect(realFs.readFileSync(file, 'utf8')).toBe(text)
    expect(realFs.existsSync(`${file}.tmp`)).toBe(false)
    expect(readJson(file)).toEqual({ a: 1, b: [2] })
  })
  it('a planted EBUSY on the rename, and on the write, is retried and lands; the pauses grow', () => {
    const file = path.join(dir, 'a.json')
    writeJsonAtomic(file, { v: 'old' })
    let renames = 0
    let writes = 0
    const { fs } = countingFs({
      renameSync: (real, ...a) => { if (++renames <= 2) throw locked('EBUSY'); return real(...a) },
      writeFileSync: (real, ...a) => { if (++writes <= 1) throw locked('EPERM'); return real(...a) },
    })
    const pauses = []
    writeJsonAtomic(file, { v: 'new' }, { fs, pause: (ms) => pauses.push(ms) })
    expect(readJson(file)).toEqual({ v: 'new' })
    expect(pauses).toEqual([20, 20, 40])
  })
  it(`a lock past ${WRITE_ATTEMPTS} tries propagates; the old file is whole and the newer text waits in the .tmp`, () => {
    const file = path.join(dir, 'a.json')
    writeJsonAtomic(file, { v: 'old' })
    const { fs } = countingFs({ renameSync: () => { throw locked('EACCES') } })
    expect(() => writeJsonAtomic(file, { v: 'new' }, { fs, pause: () => {} })).toThrow(/EACCES/)
    expect(readJson(file)).toEqual({ v: 'old' })
    expect(readJson(`${file}.tmp`)).toEqual({ v: 'new' })
  })
  it('a crash in the middle of the write leaves the previous file readable; FAILING CONTROL: the in-place writer it replaces leaves a torn one that reads as nothing', () => {
    const file = path.join(dir, 'project.json')
    const old = { project: { id: 'p1', title: 'Salt Hours' }, tasks: Array.from({ length: 50 }, (_, i) => ({ id: `t${i}` })) }
    writeJsonAtomic(file, old)
    // The crash: half the text reaches the disk, then the process stops.
    const crash = (real, f, text) => { real(f, String(text).slice(0, Math.floor(String(text).length / 2))); throw Object.assign(new Error('EIO: the app stopped'), { code: 'EIO' }) }
    const next = { ...old, project: { ...old.project, title: 'Salt Hours 2' } }
    const { fs } = countingFs({ writeFileSync: crash })
    expect(() => writeJsonAtomic(file, next, { fs })).toThrow(/EIO/)
    expect(readJson(file, 'TORN')).toEqual(old)
    // CONTROL: main.cjs's writeJSON before F3, under the same crash.
    const inPlace = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 2))
    expect(() => inPlace(file, next)).toThrow(/EIO/)
    expect(readJson(file, 'TORN')).toBe('TORN')
  })
  it('a non-lock error is not retried', () => {
    const file = path.join(dir, 'a.json')
    const { fs, counts } = countingFs({ renameSync: () => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }) } })
    expect(() => writeJsonAtomic(file, {}, { fs, pause: () => {} })).toThrow(/EXDEV/)
    expect(counts.renameSync).toBe(1)
  })
  it('durable: the temporary file is synced to the disk before the rename', () => {
    const file = path.join(dir, 'archive.json')
    const { fs, counts } = countingFs()
    writeJsonAtomic(file, { archived: true }, { fs, durable: true })
    expect(counts.fsyncSync).toBe(1)
    expect(counts.writeFileSync).toBeUndefined()
    expect(readJson(file)).toEqual({ archived: true })
  })
  it('readJson: the value, or the fallback for a missing file and for one that is not JSON', () => {
    const file = path.join(dir, 'x.json')
    expect(readJson(file, 'fb')).toBe('fb')
    realFs.writeFileSync(file, '{"a":')
    expect(readJson(file, 'fb')).toBe('fb')
    expect(readJson(file)).toBeNull()
  })
})

// ── 2. The kept files ────────────────────────────────────────────────────────
describe('createKeptFiles — the text last read or written, while the file is unchanged', () => {
  const setUp = () => {
    const file = path.join(dir, 'project.json')
    const kept = createKeptFiles()
    kept.keep(file, writeJsonAtomic(file, { v: 1, list: ['a'] }))
    return { file, kept }
  }
  it('its own write is a hit, and every read is a separate object (a caller that mutates and refuses changes nothing kept)', () => {
    const { file, kept } = setUp()
    const a = kept.read(file)
    a.list.push('mutated, never written')
    const b = kept.read(file)
    expect(b).toEqual({ v: 1, list: ['a'] })
    expect(b).not.toBe(a)
  })
  it('a hand edit (a new size), a new time alone, a file copied over it, a delete — each is a miss, and the entry goes', () => {
    const { file, kept } = setUp()
    realFs.writeFileSync(file, JSON.stringify({ v: 2, list: ['a', 'b'] }))
    expect(kept.read(file)).toBeNull()
    kept.keep(file, realFs.readFileSync(file, 'utf8'))
    const t = new Date(Date.now() + 60_000)
    realFs.utimesSync(file, t, t)
    expect(kept.read(file)).toBeNull()
    kept.keep(file, realFs.readFileSync(file, 'utf8'))
    const other = path.join(dir, 'other.json')
    realFs.writeFileSync(other, JSON.stringify({ v: 3, list: ['c', 'd'] }))
    realFs.copyFileSync(other, file)
    expect(kept.read(file)).toBeNull()
    kept.keep(file, realFs.readFileSync(file, 'utf8'))
    realFs.unlinkSync(file)
    expect(kept.read(file)).toBeNull()
    expect(kept.usage().files).toBe(0)
  })
  it('FAILING CONTROL: a cache that ignores the stamp serves the stale text after the hand edit', () => {
    const file = path.join(dir, 'project.json')
    const plain = new Map()
    plain.set(file, writeJsonAtomic(file, { v: 1 }))
    realFs.writeFileSync(file, JSON.stringify({ v: 2, edited: true }))
    expect(JSON.parse(plain.get(file))).not.toEqual(readJson(file))
  })
  it('the stamp taken before a read: a change after it is seen at the next read', () => {
    const file = path.join(dir, 'project.json')
    const kept = createKeptFiles()
    writeJsonAtomic(file, { v: 1 })
    const before = kept.stamp(file)
    const text = realFs.readFileSync(file, 'utf8')
    realFs.writeFileSync(file, JSON.stringify({ v: 2, more: 'bytes' }))
    kept.keep(file, text, before)
    expect(kept.read(file)).toBeNull()
  })
  it('nothing is kept for a file that is not there, for a null stamp or for text that is not a string; keep never throws', () => {
    const kept = createKeptFiles()
    const gone = path.join(dir, 'gone.json')
    expect(kept.keep(gone, '{}')).toBe(false)
    expect(kept.read(gone)).toBeNull()
    const file = path.join(dir, 'a.json')
    writeJsonAtomic(file, {})
    expect(kept.keep(file, '{}', null)).toBe(false)
    expect(kept.keep(file, undefined)).toBe(false)
    expect(kept.usage()).toEqual({ files: 0, bytes: 0 })
  })
  it('bounded: counted at two bytes a character, the least recently used goes first, and one text over a quarter of the budget is never kept', () => {
    const kept = createKeptFiles({ maxBytes: 4000 })
    const files = ['a', 'b', 'c'].map((n) => path.join(dir, `${n}.json`))
    for (const f of files) kept.keep(f, writeJsonAtomic(f, { pad: 'x'.repeat(450) })) // 465 characters: 930 bytes each
    expect(kept.usage()).toEqual({ files: 3, bytes: 3 * 930 })
    expect(kept.read(files[0])).not.toBeNull() // a is now the most recent
    for (const n of ['d', 'e']) { const f = path.join(dir, `${n}.json`); kept.keep(f, writeJsonAtomic(f, { pad: 'y'.repeat(450) })) }
    expect(kept.usage().bytes).toBeLessThanOrEqual(4000)
    expect(kept.read(files[1])).toBeNull() // b was the least recently used
    expect(kept.read(files[0])).not.toBeNull()
    const big = path.join(dir, 'big.json')
    expect(kept.keep(big, writeJsonAtomic(big, { pad: 'z'.repeat(600) }))).toBe(false) // 1,200+ bytes > 4000 / 4
  })
})

// ── 3. Mirrors written only when they change ─────────────────────────────────
describe('mirrorProjectDatabases (main.cjs, lifted) — six files, each written only when its text changed or it is gone', () => {
  const bundleOf = () => ({
    project: { id: 'p1', title: 'Salt Hours', folder_slug: 'Salt-Hours' },
    projectTeam: [], tasks: [{ id: 't1', name: 'Build the set', status: 'todo' }], phases: [], dependencies: [], taskLinks: [],
    taskItems: [], budgetLines: [{ id: 'b1', amount: 10 }], budgetActuals: [], budgetVersions: [], expenses: [],
    shotLists: [], shotListItems: [], scenes: [], shots: [], edits: [],
  })
  const lift = (mirrors, fsImpl) => new Function('resolveProjectFolder', 'fileSlugify', 'path', 'fs', 'databaseMirrors', 'console',
    `${extractFunction(MAIN, 'mirrorProjectDatabases')}\nreturn mirrorProjectDatabases;`)(
    () => dir, (s) => s, path, fsImpl, mirrors, { error: (...a) => { throw new Error(a.join(' ')) } })
  const db = () => path.join(dir, 'Salt-Hours_DATABASES')

  it('the first pass writes all six; the same bundle again writes none; a task edit writes tasks.json and timeline.json only', () => {
    const c = countingFs()
    const mirror = lift(createChangeOnlyWriter({ fs: c.fs }), c.fs)
    const b = bundleOf()
    mirror('p1', b)
    expect(realFs.readdirSync(db()).sort()).toEqual(['budget.json', 'project.json', 'scenes.json', 'tasks.json', 'team.json', 'timeline.json'])
    expect(c.counts.renameSync).toBe(6)
    c.reset()
    mirror('p1', b)
    expect(c.counts.renameSync).toBeUndefined()
    c.reset()
    b.tasks[0].status = 'done'
    mirror('p1', b)
    expect(c.counts.renameSync).toBe(2)
    expect(readJson(path.join(db(), 'tasks.json')).tasks[0].status).toBe('done')
  })
  it('a mirror removed by hand, and the whole folder removed (a reset, a new project at the same place), are written again though nothing changed', () => {
    const c = countingFs()
    const mirror = lift(createChangeOnlyWriter({ fs: c.fs }), c.fs)
    const b = bundleOf()
    mirror('p1', b)
    realFs.unlinkSync(path.join(db(), 'team.json'))
    c.reset()
    mirror('p1', b)
    expect(c.counts.renameSync).toBe(1)
    expect(realFs.existsSync(path.join(db(), 'team.json'))).toBe(true)
    realFs.rmSync(db(), { recursive: true, force: true })
    c.reset()
    mirror('p1', b)
    expect(c.counts.renameSync).toBe(6)
  })
  it('a write that fails records nothing: the next pass writes it, though the older file is still there', () => {
    let fail = false
    const c = countingFs({ renameSync: (real, ...a) => { if (fail && String(a[1]).endsWith('budget.json')) throw new Error('EIO'); return real(...a) } })
    const mirrors = createChangeOnlyWriter({ fs: c.fs })
    const lifted = new Function('resolveProjectFolder', 'fileSlugify', 'path', 'fs', 'databaseMirrors', 'console',
      `${extractFunction(MAIN, 'mirrorProjectDatabases')}\nreturn mirrorProjectDatabases;`)(
      () => dir, (s) => s, path, c.fs, mirrors, { error: () => {} })
    const b = bundleOf()
    lifted('p1', b)
    b.budgetLines[0].amount = 20
    fail = true
    lifted('p1', b) // refused: the older budget.json stays
    expect(readJson(path.join(db(), 'budget.json')).budgetLines).toEqual([{ id: 'b1', amount: 10 }])
    fail = false
    lifted('p1', b)
    expect(readJson(path.join(db(), 'budget.json')).budgetLines).toEqual([{ id: 'b1', amount: 20 }])
  })
  it('FAILING CONTROL: a writer that always writes (the tip) rewrites all six for the same bundle', () => {
    const c = countingFs()
    const always = { writerFor: () => (file, data) => { writeJsonAtomic(file, data, { fs: c.fs }); return true } }
    const mirror = lift(always, c.fs)
    mirror('p1', bundleOf())
    c.reset()
    mirror('p1', bundleOf())
    expect(c.counts.renameSync).toBe(6)
  })
})

// ── 4. The bundle, read and written ──────────────────────────────────────────
const CURRENT = () => ({
  project: { id: 'p1', title: 'Salt Hours', folder_slug: 'Salt-Hours' },
  projectTeam: [], managedFiles: [], budgetLines: [], budgetActuals: [], budgetVersions: [], expenses: [],
  scenes: [], shots: [], levels: [], experiences: [], fileEvents: [], folders: [],
  shotLists: [], shotListItems: [], edits: [], tasks: [{ id: 't1', project_id: 'p1', name: 'Build the set' }], taskItems: [],
  tableViews: [], itemGroupings: [], legalLabelsSettled: { at: '2026-09-01T00:00:00.000Z', stripped: [] },
})
// writeRabbitBundle as it was at the tip (796399cf), for the controls.
const TIP_WRITE = `function writeRabbitBundle(projectId, bundle, { touch = true } = {}) {
  if (touch) bundle.project.updated_at = new Date().toISOString();
  if (!bundle.projectTeam) bundle.projectTeam = [];
  writeJSON(rabbitBundlePath(projectId), bundle);
  if (touch) mirrorProjectDatabases(projectId, bundle);
}`

function liftBundleIO({ fsPlant = {}, demoRoot = null, kept, writeSource } = {}) {
  const c = countingFs(fsPlant)
  const spies = { ensureProjectFolders: 0, mirrors: 0, events: [] }
  const rabbitBundles = kept || createKeptFiles({ fs: c.fs })
  let ids = 0
  const names = ['fs', 'path', 'readJSON', 'writeJSON', 'rabbitBundlePath', 'rabbitBundles', 'uuidv4',
    'backfillShotListsOnRead', 'ensureShotListKeys', 'pruneDanglingShotListItems', 'rabbitTaskItems', 'rabbitTableViews',
    'ensureProjectFolderRows', 'materializeFolderDirs', 'ensureProjectFolders', 'legalFiling', 'localDemoRootDir',
    'localDemoProjectsDir', 'isPathInside', 'rabbitLogFileEvent', 'mirrorProjectDatabases']
  const values = [c.fs, path, (f, fb = null) => readJson(f, fb, c.fs), (f, d) => writeJsonAtomic(f, d, { fs: c.fs, pause: () => {} }),
    (id) => { realFs.mkdirSync(path.join(dir, 'projects', id), { recursive: true }); return path.join(dir, 'projects', id, 'project.json') },
    rabbitBundles, () => `id-${++ids}`,
    backfillShotListsOnRead, ensureShotListKeys, pruneDanglingShotListItems, rabbitTaskItems, rabbitTableViews,
    () => false, () => {}, () => { spies.ensureProjectFolders += 1 }, { settleLegalLabels: () => ({ stripped: [], settled: true }) },
    () => demoRoot, () => (demoRoot ? path.join(demoRoot, 'projects') : null), isPathInside,
    (b, e) => { spies.events.push(e.event); (b.fileEvents ||= []).push(e) }, () => { spies.mirrors += 1 }]
  const src = [extractFunction(MAIN, 'fileSlugify'), extractFunction(MAIN, 'reconcileRabbitBundle'),
    extractFunction(MAIN, 'rebaseGoneFolderRoot'), extractFunction(MAIN, 'readRabbitBundle'),
    writeSource || extractFunction(MAIN, 'writeRabbitBundle')].join('\n')
  const io = new Function(...names, `${src}\nreturn { readRabbitBundle, writeRabbitBundle };`)(...values)
  const file = (id = 'p1') => path.join(dir, 'projects', id, 'project.json')
  const put = (bundle, id = 'p1') => { realFs.mkdirSync(path.dirname(file(id)), { recursive: true }); realFs.writeFileSync(file(id), JSON.stringify(bundle, null, 2)) }
  return { ...io, c, spies, file, put, rabbitBundles }
}

describe('readRabbitBundle / writeRabbitBundle (main.cjs, lifted) — kept in memory, reconciled once per disk load and on every write', () => {
  it('the second read does not read the file or reconcile: one stat; the caller still gets its own object', () => {
    const io = liftBundleIO()
    io.put(CURRENT())
    const first = io.readRabbitBundle('p1')
    expect(io.c.counts.readFileSync).toBe(1)
    expect(io.spies.ensureProjectFolders).toBe(1)
    io.c.reset()
    first.tasks.push({ id: 'never-written' })
    const second = io.readRabbitBundle('p1')
    expect(io.c.counts.readFileSync).toBeUndefined()
    expect(io.c.counts.statSync).toBe(1)
    expect(io.spies.ensureProjectFolders).toBe(1)
    expect(second.tasks.map(t => t.id)).toEqual(['t1'])
  })
  it('FAILING CONTROL: with nothing kept (a budget of 0), every read reads the file and reconciles again', () => {
    const io = liftBundleIO({ kept: createKeptFiles({ maxBytes: 0 }) })
    io.put(CURRENT())
    io.readRabbitBundle('p1')
    io.c.reset()
    io.readRabbitBundle('p1')
    expect(io.c.counts.readFileSync).toBe(1)
    expect(io.spies.ensureProjectFolders).toBe(2)
  })
  it('a write keeps its own text: the next read is the written bundle without reading the file', () => {
    const io = liftBundleIO()
    io.put(CURRENT())
    const b = io.readRabbitBundle('p1')
    b.tasks[0].name = 'Strike the set'
    io.writeRabbitBundle('p1', b)
    io.c.reset()
    const again = io.readRabbitBundle('p1')
    expect(io.c.counts.readFileSync).toBeUndefined()
    expect(again.tasks[0].name).toBe('Strike the set')
    expect(readJson(io.file()).tasks[0].name).toBe('Strike the set')
    expect(io.spies.mirrors).toBe(1)
  })
  it('a hand edit is reloaded and reconciled in full (a slug that walks out of the folder made safe)', () => {
    const io = liftBundleIO()
    io.put(CURRENT())
    io.readRabbitBundle('p1')
    io.put({ ...CURRENT(), project: { id: 'p1', title: 'Salt Hours', folder_slug: '..\\..\\Elsewhere' } })
    io.c.reset()
    const b = io.readRabbitBundle('p1')
    expect(io.c.counts.readFileSync).toBe(1)
    expect(b.project.folder_slug).toBe('Elsewhere')
    expect(readJson(io.file()).project.folder_slug).toBe('Elsewhere')
  })
  it('a write keeps what a read of the file would give: a title that slugifies to nothing is named (design round, finding 1)', () => {
    const io = liftBundleIO()
    io.writeRabbitBundle('p1', { ...CURRENT(), project: { id: 'p1', title: 'Проект', folder_slug: '' } })
    expect(readJson(io.file()).project.folder_slug).toBe('Untitled-Project')
    expect(io.readRabbitBundle('p1').project.folder_slug).toBe('Untitled-Project')
  })
  it('FAILING CONTROL: the tip\'s writeRabbitBundle stores the empty slug, which the kept read would then serve all session', () => {
    const io = liftBundleIO({ writeSource: TIP_WRITE })
    io.writeRabbitBundle('p1', { ...CURRENT(), project: { id: 'p1', title: 'Проект', folder_slug: '' } })
    expect(readJson(io.file()).project.folder_slug).toBe('')
  })
  it('a load whose dirty write fails keeps nothing: the next read loads, reconciles and writes again', () => {
    let fail = 1
    const io = liftBundleIO({ fsPlant: { writeFileSync: (real, ...a) => { if (fail-- > 0) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return real(...a) } } })
    const legacy = CURRENT()
    delete legacy.projectTeam
    io.put(legacy)
    expect(io.readRabbitBundle('p1').projectTeam).toEqual([])
    expect(readJson(io.file()).projectTeam).toBeUndefined()
    io.c.reset()
    io.readRabbitBundle('p1')
    expect(io.c.counts.readFileSync).toBe(1)
    expect(readJson(io.file()).projectTeam).toEqual([])
  })
  it('a deleted bundle is never a hit', () => {
    const io = liftBundleIO()
    io.put(CURRENT())
    io.readRabbitBundle('p1')
    realFs.unlinkSync(io.file())
    expect(io.readRabbitBundle('p1')).toBeNull()
  })
  it('with a demo folder open, a project folder outside it that goes mid-session is rebased on a kept read, and persisted (finding 8)', () => {
    const demo = path.join(dir, 'demo')
    const outside = path.join(dir, 'outside', 'Salt-Hours')
    realFs.mkdirSync(outside, { recursive: true })
    const io = liftBundleIO({ demoRoot: demo })
    io.put({ ...CURRENT(), project: { ...CURRENT().project, folder_root: outside } })
    expect(io.readRabbitBundle('p1').project.folder_root).toBe(outside)
    realFs.rmSync(path.join(dir, 'outside'), { recursive: true, force: true })
    io.c.reset()
    const b = io.readRabbitBundle('p1')
    expect(io.c.counts.readFileSync).toBeUndefined()
    expect(b.project.folder_root).toBe(path.join(demo, 'projects', 'Salt-Hours'))
    expect(readJson(io.file()).project.folder_root).toBe(path.join(demo, 'projects', 'Salt-Hours'))
    expect(io.spies.events).toEqual(['relinked'])
  })
})

// ── 5. The subjects GET reads; the writes keep the order ─────────────────────
// renumberSubjects and the GET as they were at the tip (796399cf).
const TIP_SUBJECTS = `function renumberSubjects(softwareSlug) {
  const subjDir = path.join(getSoftwareDir(), softwareSlug, 'subjects');
  if (!fs.existsSync(subjDir)) return [];
  const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
  const subjects = files.map(f => {
    const data = readJSON(path.join(subjDir, f), {});
    return { fileName: f, slug: f.replace('.json', ''), data };
  });
  subjects.sort((a, b) => {
    const sa = getCurriculumScore(a.data.title, a.data.skill_level);
    const sb = getCurriculumScore(b.data.title, b.data.skill_level);
    if (sa !== sb) return sa - sb;
    return (a.data.title || '').localeCompare(b.data.title || '');
  });
  subjects.forEach((s, i) => {
    s.data.subject_order = i + 1;
    writeJSON(path.join(subjDir, s.fileName), s.data);
  });
  return subjects.map(s => ({
    slug: s.slug, title: s.data.title || s.slug, description: s.data.description || '',
    skill_level: s.data.skill_level || 'beginner', is_stub: s.data.is_stub || false,
    subject_order: s.data.subject_order
  }));
}`
const TIP_GET = `{
  const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
  if (!fs.existsSync(subjDir)) return res.json([]);
  const sorted = renumberSubjects(req.params.slug);
  res.json(sorted);
}`
const SUBJECTS = [
  ['delivering-a-dcp', 'Delivering a DCP', 'advanced'],
  ['colour-fundamentals', 'Colour fundamentals', 'intermediate'],
  ['project-setup-and-media', 'Project setup and media', 'beginner'],
  ['types-and-variables', 'Types and variables', 'beginner'],
  ['editing-on-the-edit-page', 'Editing on the Edit page', 'intermediate'],
  ['classes-structs-and-records', 'Classes, structs and records', 'beginner'],
]
function liftSubjects({ tip = false, postSource = null, fsPlant = {} } = {}) {
  const c = countingFs(fsPlant)
  const software = path.join(dir, 'software')
  const subjDir = path.join(software, 'resolve', 'subjects')
  realFs.mkdirSync(subjDir, { recursive: true })
  const block = MAIN.slice(MAIN.indexOf('    function readSubjects('), MAIN.indexOf('    // ── Subject endpoints ──'))
  const helpers = tip ? TIP_SUBJECTS : block
  const getBody = tip ? TIP_GET : extractRouteBody(MAIN, "expressApp.get('/api/software/:slug/subjects',")
  const postBody = postSource || extractRouteBody(MAIN, "expressApp.post('/api/software/:slug/subjects',")
  const make = new Function('fs', 'path', 'readJSON', 'writeJSON', 'getSoftwareDir', 'slugify',
    `${extractFunction(MAIN, 'getCurriculumScore')}\n${helpers}\nreturn { get: (req, res) => ${getBody}, post: (req, res) => ${postBody}, renumberSubjects };`)
  const routes = make(c.fs, path, (f, fb = null) => readJson(f, fb, c.fs), (f, d) => writeJsonAtomic(f, d, { fs: c.fs }),
    () => software, (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  const call = (verb, body = {}) => {
    const res = { code: 200, body: null, status(x) { this.code = x; return this }, json(b) { this.body = b; return this } }
    routes[verb]({ params: { slug: 'resolve' }, body, query: {} }, res)
    return res
  }
  const seed = (rows = SUBJECTS) => rows.forEach(([slug, title, skill_level], i) => writeJsonAtomic(path.join(subjDir, `${slug}.json`), { title, skill_level, subject_order: i + 1, sections: [] }))
  return { c, call, seed, subjDir, routes }
}

describe('the subjects GET (main.cjs, lifted) reads only; the writes keep the order', () => {
  it('a GET of six subjects writes nothing and lists them in the order the writes keep', () => {
    const s = liftSubjects()
    s.seed()
    s.routes.renumberSubjects('resolve') // the order a write keeps
    const stored = realFs.readdirSync(s.subjDir).map((f) => [f, realFs.readFileSync(path.join(s.subjDir, f), 'utf8')])
    s.c.reset()
    const res = s.call('get')
    expect(s.c.counts.renameSync).toBeUndefined()
    expect(s.c.counts.writeFileSync).toBeUndefined()
    expect(res.body.map((x) => x.subject_order)).toEqual([1, 2, 3, 4, 5, 6])
    expect(realFs.readdirSync(s.subjDir).map((f) => [f, realFs.readFileSync(path.join(s.subjDir, f), 'utf8')])).toEqual(stored)
  })
  it('FAILING CONTROL: the tip\'s GET rewrote all six on every list', () => {
    const s = liftSubjects({ tip: true })
    s.seed()
    s.c.reset()
    s.call('get')
    expect(s.c.counts.renameSync).toBe(6)
  })
  it('the list is what the tip\'s GET answered (the curriculum order), once the writes have run', () => {
    const now = liftSubjects()
    now.seed()
    now.routes.renumberSubjects('resolve')
    const after = now.call('get').body
    realFs.rmSync(path.join(dir, 'software'), { recursive: true, force: true })
    const tip = liftSubjects({ tip: true })
    tip.seed()
    expect(after).toEqual(tip.call('get').body)
  })
  it('a new subject from a prompt (no number) lands in its curriculum place, on the list and on disk', () => {
    const s = liftSubjects()
    s.seed()
    s.routes.renumberSubjects('resolve')
    s.call('post', { slug: 'arrays-and-lists', title: 'Arrays and lists', skill_level: 'beginner', sections: [] })
    const list = s.call('get').body
    const at = list.findIndex((x) => x.slug === 'arrays-and-lists')
    expect(at).toBeLessThan(list.length - 1)
    for (const x of list) expect(readJson(path.join(s.subjDir, `${x.slug}.json`)).subject_order).toBe(x.subject_order)
  })
  it('FAILING CONTROL: the same POST without the renumber leaves the new subject last', () => {
    const post = extractRouteBody(MAIN, "expressApp.post('/api/software/:slug/subjects',").replace('renumberSubjects(req.params.slug);', '')
    const s = liftSubjects({ postSource: post })
    s.seed()
    s.routes.renumberSubjects('resolve')
    s.call('post', { slug: 'arrays-and-lists', title: 'Arrays and lists', skill_level: 'beginner', sections: [] })
    expect(s.call('get').body.at(-1).slug).toBe('arrays-and-lists')
  })
  it('a subject file that cannot be read is listed (by its slug, last) and never written over; FAILING CONTROL: the tip overwrote it', () => {
    const s = liftSubjects()
    s.seed()
    realFs.writeFileSync(path.join(s.subjDir, 'held.json'), '{"title": "half a lesson",')
    const list = s.call('get').body
    expect(list.at(-1)).toMatchObject({ slug: 'held', title: 'held' })
    s.routes.renumberSubjects('resolve')
    expect(realFs.readFileSync(path.join(s.subjDir, 'held.json'), 'utf8')).toBe('{"title": "half a lesson",')
    const tip = liftSubjects({ tip: true })
    tip.call('get')
    expect(realFs.readFileSync(path.join(tip.subjDir, 'held.json'), 'utf8')).not.toBe('{"title": "half a lesson",')
  })
  it('one order whatever order the folder lists, with ties and subjects that have no number (finding 4)', () => {
    const rows = [['a', 'Alpha', 1], ['b', 'Bravo', 2], ['c', 'Charlie', 2], ['d', 'Delta', null], ['e', 'Echo', null]]
    const answers = new Set()
    for (let k = 0; k < 6; k++) {
      const s = liftSubjects({ fsPlant: { readdirSync: (real, ...a) => { const n = real(...a); const r = [...n]; for (let i = 0; i < k; i++) r.push(r.shift()); return k % 2 ? r.reverse() : r } } })
      for (const [slug, title, order] of rows) writeJsonAtomic(path.join(s.subjDir, `${slug}.json`), order == null ? { title } : { title, subject_order: order })
      answers.add(JSON.stringify(s.call('get').body.map((x) => x.slug)))
      realFs.rmSync(path.join(dir, 'software'), { recursive: true, force: true })
    }
    expect(answers.size).toBe(1)
    const order = JSON.parse([...answers][0])
    expect(order[0]).toBe('a') // numbered first, by number
    expect(order.slice(1, 3).sort()).toEqual(['b', 'c']) // a tie, broken the same way every time
    expect(order.slice(3).sort()).toEqual(['d', 'e']) // no number: after every numbered one
  })
})

// ── 6. The PATCH's sub-folders; the one writer everywhere; the 50 MB limit ────
describe('main.cjs — the project PATCH, the writers, the body limit', () => {
  const patchRoute = (body) => new Function(
    'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'folderRootRefusal', 'fileSlugify', 'path', 'fs',
    'resolveConfiguredRootDir', 'ensureProjectFolderRows', 'materializeFolderDirs', 'ensureProjectFolders', 'console',
    `return (req, res) => ${body}`)
  const replay = (body) => {
    const made = []
    const bundle = { project: { id: 'p1', title: 'Salt Hours', folder_root: null, folder_slug: 'Salt-Hours' }, budgetVersions: [] }
    const handler = patchRoute(body)(() => bundle, () => {}, () => {}, (p) => ({ resolved: p }), (s) => String(s), path,
      { existsSync: () => false }, () => null, () => false, () => {}, (b) => made.push(b.project.folder_root), { error: () => {} })
    handler({ params: { id: 'p1' }, body: { folder_root: path.join(dir, 'NAS', 'Salt-Hours') }, query: {} }, { status() { return this }, json() { return this } })
    return made
  }
  const PATCH = extractRouteBody(MAIN, "expressApp.patch('/api/rabbit/projects/:id',")
  it('a PATCH to a new place makes the five sub-folders there (the next read did; a kept read does not)', () => {
    expect(replay(PATCH)).toEqual([path.join(dir, 'NAS', 'Salt-Hours')])
  })
  it('FAILING CONTROL: the PATCH without that call makes none', () => {
    expect(replay(PATCH.replace('ensureProjectFolders(bundle);', ''))).toEqual([])
  })
  it('every JSON file main.cjs writes goes through the one writer: the only writeFileSync left write bytes (a thumbnail, the sealed session)', () => {
    const left = MAIN.split('\n').filter((l) => l.includes('writeFileSync(')).map((l) => l.trim())
    expect(left).toEqual(['fs.writeFileSync(thumbPath, buf);', 'fs.writeFileSync(getSessionPath(), encrypted);'])
    expect(MAIN).not.toMatch(/renameSync\([^)]*\.part/)
    expect(extractFunction(MAIN, 'writeJSON')).toMatch(/return writeJsonAtomic\(filePath, data\);/)
    expect(extractFunction(MAIN, 'archiveLocalRabbitData')).toMatch(/writeJsonAtomic\(archivePath, snapshot, \{ fs, durable: true \}\)/)
  })
  it('localDemoRoot.cjs writes its pointer and manifest through the same writer', () => {
    expect(DEMO).not.toMatch(/writeFileSync\(/)
    expect(DEMO).toMatch(/writeJsonAtomic\(file, data, \{ fs \}\)/)
  })
  it('the subjects GET neither writes nor renumbers', () => {
    const get = extractRouteBody(MAIN, "expressApp.get('/api/software/:slug/subjects',")
    expect(get).not.toMatch(/writeJSON|renumberSubjects/)
  })
  it('express.json keeps its 50 MB limit (older projects carry base64 deck attachments), mounted before the project routes', () => {
    const at = MAIN.indexOf("expressApp.use(express.json({ limit: '50mb' }));")
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(MAIN.indexOf("expressApp.get('/api/rabbit/projects',"))
  })
})
