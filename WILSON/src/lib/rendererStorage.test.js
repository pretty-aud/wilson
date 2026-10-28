// =============================================================================
// rendererStorage.test.js — D1 (night 4, 2026-10-28; docs/design/
// RECONNECT_DESIGN.md §12): the renderer's localStorage kept across a desktop
// relaunch.
//
// Three parts, each through the real code:
//   * electron/rendererStorage.cjs — the file, what is never kept, the bound,
//     the write, the seed, the sender check — on a real file in a temp folder,
//     a "launch" being a new instance over the same file;
//   * electron/preload.cjs — run whole in a VM whose `require` allows only
//     what a sandboxed preload's does (electron, events, timers, url), with a
//     fake bridge: the bridges first, the seed, the write-back;
//   * electron/main.cjs's wiring, read from source (it requires Electron at
//     load): the channels beside the token's, the sender check, the clear.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import * as realFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const {
  createRendererStorage, acceptsSender, rendererStorageFile, readKept, isKeptPair,
  FILE_NAME, DEV_FILE_NAME, MAX_KEPT_CHARS,
} = require('../../electron/rendererStorage.cjs')

const here = dirname(fileURLToPath(import.meta.url))
const source = (p) => readFileSync(resolve(here, p), 'utf8').replace(/\r\n/g, '\n')
const MAIN = source('../../electron/main.cjs')
const PRELOAD = source('../../electron/preload.cjs')

/** The text from `start` to the first `end` after it; throws when either is missing. */
function between(text, start, end) {
  const from = text.indexOf(start)
  const to = from < 0 ? -1 : text.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error(`rendererStorage.test: could not locate ${JSON.stringify(start)} … ${JSON.stringify(end)}`)
  return text.slice(from, to + end.length)
}

let dir
let file
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'd1-renderer-storage-')); file = join(dir, FILE_NAME) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const launch = (opts = {}) => createRendererStorage({ file, pause: () => {}, ...opts })

describe('electron/rendererStorage.cjs — the kept file', () => {
  it('a value written at one launch is read at the next: the seed of a new instance over the same file', () => {
    const one = launch()
    expect(one.seed('http://127.0.0.1:60674')).toEqual({ first: true, pairs: [] })
    expect(one.apply({ set: [['rabbit-timeline-settings-v1', '{"showWeekends":false}'], ['rabbit_team_saved_views', '[{"name":"D1"}]']], removed: [] }))
      .toEqual({ ok: true, written: true })
    const two = launch()                                             // the relaunch
    const seed = two.seed('http://127.0.0.1:60544')
    expect(seed.first).toBe(true)
    expect(new Map(seed.pairs)).toEqual(new Map([['rabbit-timeline-settings-v1', '{"showWeekends":false}'], ['rabbit_team_saved_views', '[{"name":"D1"}]']]))
    expect(two.seed('http://127.0.0.1:60544').first).toBe(false)     // a reload in the same launch
  })

  it('the first load is per origin, not per process: a second window\'s new server starts clean too (build review, F5)', () => {
    const one = launch()
    one.apply({ set: [['k', 'v']], removed: [] })
    expect(one.seed('http://127.0.0.1:1').first).toBe(true)
    expect(one.seed('http://127.0.0.1:1').first).toBe(false)
    expect(one.seed('http://127.0.0.1:2')).toEqual({ first: true, pairs: [['k', 'v']] })
  })

  it('a removed key is gone at the next launch, and an unchanged set writes nothing', () => {
    const one = launch()
    one.apply({ set: [['a', '1'], ['b', '2']], removed: [] })
    expect(one.apply({ set: [['a', '1']], removed: [] })).toEqual({ ok: true, written: false })
    one.apply({ set: [], removed: ['b'] })
    expect(launch().keys()).toEqual(['a'])
  })

  it('never kept, whatever it is sent: the session keys, the idle clocks, tus fingerprints', () => {
    const one = launch()
    const session = JSON.stringify({ access_token: 'made-up', refresh_token: 'made-up' })
    one.apply({
      set: [
        ['wilson.dev.session', session], ['wilson.operator.session', session], ['sb-abc-auth-token', session],
        ['wilson.dev.session.activity', '1793170282765'], ['wilson.operator.session.activity', '1'],
        ['tus::wilson/bucket/key::1', '{"uploadUrl":"https://example.invalid/x"}'],
        ['wilson.dev.session.start', '{"sid":"s","at":1}'], ['wilson.lastCompany', 'Petal'],
      ],
      removed: [],
    })
    expect(one.keys().sort()).toEqual(['wilson.dev.session.start', 'wilson.lastCompany'])
    const onDisk = readFileSync(file, 'utf8')
    for (const absent of ['made-up', 'activity', 'tus::', 'sb-abc']) expect(onDisk).not.toContain(absent)
    expect(isKeptPair('wilson.dev.session.start', '{}')).toBe(true)
  })

  it('ordinary text is kept whole, a prompt naming a local model server included (build review, F2)', () => {
    const prompts = JSON.stringify({ scheduler: 'Use the model at http://127.0.0.1:11434 for drafts.' })
    launch().apply({ set: [['rabbit-prompts-v1', prompts]], removed: [] })
    expect(new Map(launch().seed('o').pairs).get('rabbit-prompts-v1')).toBe(prompts)
  })

  it('a file Windows holds past the retries is never written over: no seed, every change refused, the file untouched (build review, F1)', () => {
    launch().apply({ set: [['rabbit-timeline-settings-v1', '{"showWeekends":false}'], ['wilson.lastCompany', 'Petal']], removed: [] })
    const before = readFileSync(file, 'utf8')
    const locked = { ...realFs, readFileSync: () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e } }
    const lines = []
    const held = launch({ fsImpl: locked, log: (l) => lines.push(l) })
    expect(held.seed('o')).toBeNull()
    expect(held.apply({ set: [['wilson.update.skipped-version', '9.9.9']], removed: [] })).toEqual({ ok: false, reason: 'unreadable' })
    expect(held.flush()).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(lines.join('\n')).toMatch(/could not be read/)
    // a hold that ends inside the retries is no hold at all
    let refusals = 2
    const brief = { ...realFs, readFileSync: (...a) => { if (refusals-- > 0) { const e = new Error('busy'); e.code = 'EPERM'; throw e } return realFs.readFileSync(...a) } }
    expect(new Map(launch({ fsImpl: brief }).seed('o').pairs).get('wilson.lastCompany')).toBe('Petal')
  })

  it('a .tmp cut short by a crash gives way to the file it never replaced', () => {
    launch().apply({ set: [['a', '1']], removed: [] })
    writeFileSync(`${file}.tmp`, '{"a":"2",')                        // unparseable...
    utimesSync(file, new Date(1000), new Date(1000))                  // ...and the newer of the two, so it is read first
    expect(new Map(launch().seed('o').pairs)).toEqual(new Map([['a', '1']]))
  })

  it('a write Windows refuses stays in memory and the quit writes it (build review, F3); nothing to write, nothing written', () => {
    let refusals = 2
    const flaky = { ...realFs, writeFileSync: (...a) => { if (refusals-- > 0) { const e = new Error('busy'); e.code = 'EBUSY'; throw e } return realFs.writeFileSync(...a) } }
    expect(launch({ fsImpl: flaky }).apply({ set: [['a', '1']], removed: [] })).toEqual({ ok: true, written: true })
    let down = true
    const failing = { ...realFs, writeFileSync: (...a) => { if (down) { const e = new Error('busy'); e.code = 'EBUSY'; throw e } return realFs.writeFileSync(...a) } }
    const one = launch({ fsImpl: failing })
    expect(one.apply({ set: [['b', '2']], removed: [] })).toEqual({ ok: true, written: false, reason: 'write_failed' })
    expect(new Map(launch().seed('o').pairs).has('b')).toBe(false)
    down = false
    expect(one.flush()).toBe(true)
    expect(new Map(launch().seed('o').pairs)).toEqual(new Map([['a', '1'], ['b', '2']]))
    expect(one.flush()).toBe(false)
  })

  it('the heartbeat of the idle clock alone never rewrites the file', () => {
    const one = launch()
    one.apply({ set: [['k', 'v']], removed: [] })
    const before = readFileSync(file, 'utf8')
    utimesSync(file, new Date(1000), new Date(1000))
    expect(one.apply({ set: [['wilson.dev.session.activity', String(Date.now())]], removed: [] })).toEqual({ ok: true, written: false })
    expect(realFs.statSync(file).mtimeMs).toBe(1000)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('junk is dropped, and __proto__ and hasOwnProperty are ordinary keys', () => {
    writeFileSync(file, '{"__proto__":"a","hasOwnProperty":"b","n":1,"o":{},"ok":"y"}')
    const one = launch()
    expect(new Map(one.seed().pairs)).toEqual(new Map([['__proto__', 'a'], ['hasOwnProperty', 'b'], ['ok', 'y']]))
    one.apply({ set: [['__proto__', 'c']], removed: ['ok'] })
    expect(new Map(launch().seed().pairs)).toEqual(new Map([['__proto__', 'c'], ['hasOwnProperty', 'b']]))
    writeFileSync(file, 'not json')
    expect(launch().seed().pairs).toEqual([])
  })

  it('a change set of the wrong shape, or one past the bound, is refused whole', () => {
    const one = launch({ maxChars: 40 })
    one.apply({ set: [['a', '1']], removed: [] })
    expect(one.apply({ set: { a: '2' }, removed: [] })).toEqual({ ok: false, reason: 'shape' })
    expect(one.apply({ set: [['a', 2]], removed: [] })).toEqual({ ok: false, reason: 'shape' })
    expect(one.apply({ set: [['b', 'x'.repeat(60)]], removed: [] })).toEqual({ ok: false, reason: 'too_large' })
    expect(one.apply(null)).toEqual({ ok: false, reason: 'shape' })
    expect(new Map(launch().seed().pairs)).toEqual(new Map([['a', '1']]))
    expect(MAX_KEPT_CHARS).toBeGreaterThan(5_242_880)
  })

  it('a rename Windows refuses is retried; refused every time, the map stays the truth and the newer .tmp is read at the next launch', () => {
    let refusals = 2
    const flaky = { ...realFs, renameSync: (a, b) => { if (refusals-- > 0) { const e = new Error('busy'); e.code = 'EPERM'; throw e } return realFs.renameSync(a, b) } }
    expect(launch({ fsImpl: flaky }).apply({ set: [['a', '1']], removed: [] })).toEqual({ ok: true, written: true })
    const lines = []
    const stuck = { ...realFs, renameSync: () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e } }
    const two = launch({ fsImpl: stuck, log: (l) => lines.push(l) })
    expect(two.apply({ set: [['a', '2']], removed: [] })).toEqual({ ok: true, written: false, reason: 'write_failed' })
    expect(two.keys()).toEqual(['a'])
    expect(lines.join('\n')).toMatch(/not written \(EBUSY\)/)
    utimesSync(file, new Date(1000), new Date(1000))                    // the .tmp is the newer one
    expect(new Map(launch().seed().pairs)).toEqual(new Map([['a', '2']]))
    expect(existsSync(`${file}.tmp`)).toBe(true)
  })

  it('one file per build flavour (the dev build and the installed one share a userData folder on Windows)', () => {
    expect(rendererStorageFile('C:\\ud', true)).toBe(join('C:\\ud', FILE_NAME))
    expect(rendererStorageFile('C:\\ud', false)).toBe(join('C:\\ud', DEV_FILE_NAME))
    expect(readKept(join(dir, 'absent.json'))).toEqual({ kept: new Map(), unreadable: false })
  })
})

// 🚨 The rule the module's header states: no writer keeps an address on the
// loopback server (it would outlive its port, and the launch cookie is scoped
// by host, not port). A module that builds one from the page's origin must not
// write localStorage; a new one doing both is read here first.
describe('no module that builds a loopback address writes localStorage (build review, F2)', () => {
  const walk = (d) => realFs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p)
    return /\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name) ? [p] : []
  })
  const files = walk(resolve(here, '..')).map((p) => ({ p, text: readFileSync(p, 'utf8') }))
  const builders = files.filter((f) => /localMediaUrl\(|location\.origin/.test(f.text))
  const writers = files.filter((f) => /localStorage(\?\.|\.)setItem\(|storage\?\.setItem\(/.test(f.text))
  it('the two sets are known and do not meet', () => {
    expect(builders.length).toBeGreaterThan(2)
    expect(writers.length).toBeGreaterThan(10)
    const both = builders.filter((b) => writers.some((w) => w.p === b.p)).map((f) => f.p.slice(resolve(here, '..').length + 1))
    expect(both).toEqual([])
  })
})

describe('electron/rendererStorage.cjs — acceptsSender: the main window\'s own top frame, at this launch\'s origin', () => {
  const ORIGIN = 'http://127.0.0.1:60598'
  const mainFrame = { origin: ORIGIN }
  const webContents = { mainFrame }
  it('accepts exactly that', () => {
    expect(acceptsSender({ sender: webContents, senderFrame: mainFrame }, { webContents, origin: ORIGIN })).toBe(true)
  })
  it('refuses another window, a subframe, a page the window navigated to, no frame, no window yet, and anything that throws', () => {
    expect(acceptsSender({ sender: {}, senderFrame: mainFrame }, { webContents, origin: ORIGIN })).toBe(false)
    expect(acceptsSender({ sender: webContents, senderFrame: { origin: ORIGIN } }, { webContents, origin: ORIGIN })).toBe(false)
    // the same window and its own top frame, navigated to a dropped file: only the origin refuses it
    const navigated = { origin: 'file://' }
    const sameWindow = { mainFrame: navigated }
    expect(acceptsSender({ sender: sameWindow, senderFrame: navigated }, { webContents: sameWindow, origin: ORIGIN })).toBe(false)
    expect(acceptsSender({ sender: sameWindow, senderFrame: navigated }, { webContents: sameWindow, origin: 'file://' })).toBe(true)
    expect(acceptsSender({ sender: webContents, senderFrame: null }, { webContents, origin: ORIGIN })).toBe(false)
    expect(acceptsSender({ sender: webContents, senderFrame: mainFrame }, { webContents: null, origin: ORIGIN })).toBe(false)
    expect(acceptsSender({ sender: webContents, senderFrame: mainFrame }, { webContents, origin: null })).toBe(false)
    const throwing = { get mainFrame() { throw new Error('Object has been destroyed') } }
    expect(acceptsSender({ sender: throwing, senderFrame: mainFrame }, { webContents: throwing, origin: ORIGIN })).toBe(false)
  })
})

// ── electron/preload.cjs, run whole ─────────────────────────────────────────

function fakeStorage(initial = []) {
  const m = new Map(initial)
  return {
    m,
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)) },
    removeItem: (k) => { m.delete(k) },
    clear: () => { m.clear() },
  }
}

/** Run the real preload with a fake bridge; `require` allows what a sandboxed preload's does. */
function runPreload({ seed = null, storage = fakeStorage(), seedThrows = false, storageThrows = false, sendThrows = 0 } = {}) {
  const order = []
  const exposed = {}
  const sent = []
  const timers = []
  const on = { window: {}, document: {} }
  const ipcRenderer = {
    sendSync(channel, payload) {
      if (channel === 'wilson:local-server-token') return 'made-up-token'
      if (channel === 'wilson:renderer-storage-seed') { order.push('seed'); if (seedThrows) throw new Error('no answer'); return seed }
      if (channel === 'wilson:renderer-storage-changes-sync') { sent.push({ channel, sync: true, changes: JSON.parse(JSON.stringify(payload)) }); return true }
      throw new Error(`unexpected sendSync ${channel}`)
    },
    send(channel, payload) {
      if (sendThrows > 0) { sendThrows -= 1; throw new Error('an IPC send that failed') }
      sent.push({ channel, sync: false, changes: JSON.parse(JSON.stringify(payload)) })
    },
    invoke: async () => null,
    on() {},
    removeListener() {},
  }
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { order.push(`expose ${name}`); exposed[name] = api } },
    ipcRenderer,
    webUtils: { getPathForFile: () => '' },
  }
  const allowed = { electron, events: require('events'), timers: require('timers'), url: require('url') }
  const sandboxRequire = (name) => {
    if (!Object.hasOwn(allowed, name)) throw new Error(`a sandboxed preload cannot require '${name}'`)
    return allowed[name]
  }
  const win = { addEventListener: (type, fn) => { (on.window[type] ||= []).push(fn) } }
  Object.defineProperty(win, 'localStorage', { get() { if (storageThrows) throw new Error('SecurityError'); return storage } })
  const doc = { visibilityState: 'visible', addEventListener: (type, fn) => { (on.document[type] ||= []).push(fn) } }
  const context = vm.createContext({
    require: sandboxRequire, window: win, document: doc, console,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
  })
  vm.runInContext(PRELOAD, context, { filename: 'preload.cjs' })
  return { order, exposed, sent, timers, on, doc, storage, tick: () => { for (const t of timers) t.fn() } }
}

describe('electron/preload.cjs — the bridges first, then the kept storage', () => {
  it('both bridges exist before the seed is asked for, and still exist when the seed or the storage throws', () => {
    const ok = runPreload({ seed: { first: true, pairs: [] } })
    expect(ok.order).toEqual(['expose wilsonSession', 'expose electronAPI', 'seed'])
    for (const r of [runPreload({ seedThrows: true }), runPreload({ storageThrows: true })]) {
      expect(Object.keys(r.exposed)).toEqual(['wilsonSession', 'electronAPI'])
      expect(typeof r.exposed.wilsonSession.load).toBe('function')
      expect(r.timers).toEqual([])
    }
  })

  it('the launch\'s first load makes the origin exactly the kept pairs (a recycled port\'s leftovers go)', () => {
    const storage = fakeStorage([['left-by-an-old-launch', 'x']])
    runPreload({ seed: { first: true, pairs: [['rabbit-timeline-settings-v1', '{"showWeekends":false}'], ['rabbit_edit_drafts', '{}']] }, storage })
    expect(storage.m).toEqual(new Map([['rabbit-timeline-settings-v1', '{"showWeekends":false}'], ['rabbit_edit_drafts', '{}']]))
  })

  it('what the page changes goes back once a second, removed keys included; nothing changed, nothing sent', () => {
    const r = runPreload({ seed: { first: true, pairs: [['k', 'v']] } })
    expect(r.timers.map((t) => t.ms)).toEqual([1000])
    r.tick()
    expect(r.sent).toEqual([])
    r.storage.setItem('rabbit_team_saved_views', '[{"name":"D1"}]')
    r.storage.removeItem('k')
    r.tick()
    expect(r.sent).toEqual([{ channel: 'wilson:renderer-storage-changes', sync: false, changes: { set: [['rabbit_team_saved_views', '[{"name":"D1"}]']], removed: ['k'] } }])
    r.tick()
    expect(r.sent).toHaveLength(1)
  })

  it('flushed when the window is hidden, and synchronously at pagehide', () => {
    const r = runPreload({ seed: { first: true, pairs: [] } })
    r.storage.setItem('a', '1')
    r.doc.visibilityState = 'hidden'
    for (const fn of r.on.document.visibilitychange) fn()
    r.storage.setItem('b', '2')
    for (const fn of r.on.window.pagehide) fn()
    expect(r.sent.map((s) => [s.channel, s.sync, s.changes.set])).toEqual([
      ['wilson:renderer-storage-changes', false, [['a', '1']]],
      ['wilson:renderer-storage-changes-sync', true, [['b', '2']]],
    ])
  })

  it('a reload (not the launch\'s first load) leaves the live storage alone and compares it with the main process\'s map', () => {
    const storage = fakeStorage([['written-before-a-crash', '1']])
    const r = runPreload({ seed: { first: false, pairs: [['removed-before-a-crash', '2']] }, storage })
    expect(storage.m).toEqual(new Map([['written-before-a-crash', '1']]))
    r.tick()
    expect(r.sent[0].changes).toEqual({ set: [['written-before-a-crash', '1']], removed: ['removed-before-a-crash'] })
  })

  it('a send that threw is sent again at the next flush: the baseline moves only once a change set has left (build review, F3)', () => {
    const r = runPreload({ seed: { first: true, pairs: [] }, sendThrows: 1 })
    r.storage.setItem('rabbit-holidays-v2', '[]')
    r.tick()
    expect(r.sent).toEqual([])
    r.tick()
    expect(r.sent).toEqual([{ channel: 'wilson:renderer-storage-changes', sync: false, changes: { set: [['rabbit-holidays-v2', '[]']], removed: [] } }])
  })

  it('a refused sender (no seed) keeps today\'s storage: nothing cleared, nothing sent', () => {
    const storage = fakeStorage([['k', 'v']])
    const r = runPreload({ seed: null, storage })
    expect(storage.m).toEqual(new Map([['k', 'v']]))
    expect(r.timers).toEqual([])
    expect(r.on.window.pagehide).toBeUndefined()
  })
})

describe('electron/main.cjs — the wiring, read from source', () => {
  const block = between(MAIN, "ipcMain.on('wilson:local-server-token'", "app.on('second-instance'")

  it('the three channels sit beside the token\'s, each wrapped, every synchronous call answered when refused or failed', () => {
    const seed = between(block, "ipcMain.on('wilson:renderer-storage-seed'", '\n});')
    expect(seed).toContain('event.returnValue = fromThisLaunchsPage(event) ? rendererStorageNow().seed(localServerOrigin) : null;')
    expect(seed).toMatch(/catch \{\n\s+event\.returnValue = null;/)
    const changes = between(block, "ipcMain.on('wilson:renderer-storage-changes',", '\n});')
    expect(changes).toContain('if (fromThisLaunchsPage(event)) rendererStorageNow().apply(changes);')
    expect(changes).toMatch(/\} catch \{/)
    const sync = between(block, "ipcMain.on('wilson:renderer-storage-changes-sync'", '\n});')
    expect(sync).toContain('event.returnValue = fromThisLaunchsPage(event) ? rendererStorageNow().apply(changes).ok === true : false;')
    expect(sync).toMatch(/catch \{\n\s+event\.returnValue = false;/)
  })

  it('the quit writes once more what a refused write left in memory', () => {
    expect(block).toMatch(/app\.on\('will-quit', \(\) => \{\n\s+try \{ rendererStorage\?\.flush\(\); \} catch/)
  })

  it('the sender check is the module\'s, against the live main window and this launch\'s origin; the file is per build flavour', () => {
    expect(block).toContain('return acceptsSender(event, { webContents: live, origin: localServerOrigin });')
    expect(block).toContain('const live = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;')
    expect(block).toContain("file: rendererStorageFile(app.getPath('userData'), app.isPackaged),")
  })

  it('the clear: once the server has bound, every other origin, never awaited, before the window loads', () => {
    const createWindow = between(MAIN, 'async function createWindow() {', 'mainWindow.loadURL(')
    const bound = createWindow.indexOf('await startLocalServer(distPath)')
    const origin = createWindow.indexOf('localServerOrigin = origin;')
    const clear = createWindow.indexOf("session.defaultSession.clearData({ dataTypes: ['localStorage'], excludeOrigins: [origin] })")
    expect(bound).toBeGreaterThan(-1)
    expect(origin).toBeGreaterThan(bound)
    expect(clear).toBeGreaterThan(origin)
    expect(createWindow).not.toMatch(/await\s+session\.defaultSession\.clearData/)
    expect(MAIN).not.toContain('clearStorageData(')
  })

  it('the preload\'s storage block comes after both bridges and is wrapped whole', () => {
    const bridges = PRELOAD.lastIndexOf("contextBridge.exposeInMainWorld('electronAPI'")
    const block = PRELOAD.indexOf("try {\n  const store = window.localStorage;\n  const seed = ipcRenderer.sendSync('wilson:renderer-storage-seed');")
    expect(bridges).toBeGreaterThan(-1)
    expect(block).toBeGreaterThan(bridges)
    expect(PRELOAD.trimEnd().endsWith("} catch { /* the page keeps Chromium's own storage for this launch */ }")).toBe(true)
  })

  it('the local server\'s gate is where it was: the per-launch port, the lock before the body parser', () => {
    expect(MAIN).toContain("const server = expressApp.listen(0, '127.0.0.1', () => {")
    expect(MAIN.indexOf('applyLocalServerLock(expressApp, {')).toBeLessThan(MAIN.indexOf("expressApp.use(express.json({ limit: '50mb' }));"))
  })
})
