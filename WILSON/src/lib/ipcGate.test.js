// =============================================================================
// ipcGate.test.js — D3 (night 7, 2026-10-29; docs/design/RECONNECT_DESIGN.md
// §14; OUTSTANDING D2-02): every channel the preload bridges answers WILSON's
// own page and nobody else.
//
// Four parts, each through the real code:
//   * electron/ipcGate.cjs — the gate over stand-ins (an ipcMain that records,
//     webContents and frames as plain objects), composed with D1's real
//     acceptsSender exactly as main.cjs's fromThisLaunchsPage composes it;
//   * electron/updater.cjs — loaded for real (it no longer requires Electron)
//     and handed the gate: its four channels go through it, and a registrar
//     without the gate's brand is refused;
//   * the preload, run whole in a VM: a dropped file's place only for a page
//     the main process answered as WILSON's (build review round 1, F2);
//   * every source file under electron/, PARSED (@babel/parser, so a comment
//     is never code): what that proves, and what it does not, is written above
//     the checker below (build review round 1, F1); its controls run here too,
//     and each must fail.
// Measured on the tip bb14b169 (a development build, a scratch userData): a
// page holding the preload that was not WILSON's was handed the local
// server's key, the session and every channel but D1's storage and D2's
// download. The desktop run on the build is RECONNECT_DESIGN.md §14.7.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const { createIpcGate } = require('../../electron/ipcGate.cjs')
const { acceptsSender } = require('../../electron/rendererStorage.cjs')
const { initUpdater } = require('../../electron/updater.cjs')
const parser = require('@babel/parser')

const here = dirname(fileURLToPath(import.meta.url))
const ELECTRON_DIR = resolve(here, '../../electron')

const ORIGIN = 'http://127.0.0.1:60598'
const FILE_PAGE = 'file:///C:/Users/someone/Documents/secret-invoice-0042.pdf'
const TOKEN = 'made-up-local-token-d3'

// ── stand-ins ────────────────────────────────────────────────────────────────

/** An ipcMain as Electron holds it: one handler per invoked channel (a second is refused, as Electron does), listeners per message channel. */
function fakeIpcMain() {
  const handlers = new Map()
  const listeners = new Map()
  return {
    handlers,
    listeners,
    handle(channel, fn) {
      if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
      handlers.set(channel, fn)
    },
    on(channel, fn) {
      if (!listeners.has(channel)) listeners.set(channel, [])
      listeners.get(channel).push(fn)
      return this
    },
  }
}

/** The launch as main.cjs holds it: the live main window (or none) and this launch's origin, both read at each call. */
function launch() {
  const mainFrame = { origin: ORIGIN, url: `${ORIGIN}/` }
  const mainWc = { mainFrame }
  const state = { live: mainWc, origin: ORIGIN }
  // main.cjs's fromThisLaunchsPage: acceptsSender(event, { webContents: live, origin: localServerOrigin })
  const accepts = (event) => acceptsSender(event, { webContents: state.live, origin: state.origin })
  return { mainFrame, mainWc, state, accepts }
}

function gateOver({ accepts, log } = {}) {
  const ipc = fakeIpcMain()
  const l = launch()
  const logged = []
  const gate = createIpcGate({ ipcMain: ipc, accepts: accepts || l.accepts, log: log || ((line) => logged.push(line)) })
  return { ipc, gate, logged, ...l }
}

/** An invoke as Electron makes it: the registered handler, called with the event. */
const invoke = (ipc, channel, event, ...args) => ipc.handlers.get(channel)(event, ...args)

/**
 * A message as Electron 33.4.11 delivers it: a synchronous one carries the
 * returnValue setter Electron defines (each answer recorded), an asynchronous
 * one none. Returns the answers.
 */
function message(ipc, channel, event, sync, ...args) {
  const answers = []
  if (sync) Object.defineProperty(event, 'returnValue', { set: (v) => answers.push(v), get: () => undefined, configurable: true })
  for (const fn of ipc.listeners.get(channel) || []) fn(event, ...args)
  return answers
}

/** Every sender that is not WILSON's page, each as a fresh event. */
function refusedSenders(l) {
  return [
    ['another window holding the preload', () => ({ sender: { mainFrame: { origin: ORIGIN, url: `${ORIGIN}/` } }, senderFrame: { origin: ORIGIN, url: `${ORIGIN}/` } })],
    ['a frame inside the page', () => ({ sender: l.mainWc, senderFrame: { origin: ORIGIN, url: `${ORIGIN}/a-frame` } })],
    ['the main window\'s top frame showing another page', () => {
      const elsewhere = { origin: 'file://', url: FILE_PAGE }
      l.mainWc.mainFrame = elsewhere
      return { sender: l.mainWc, senderFrame: elsewhere }
    }],
    ['no main window yet (or closed)', () => { l.state.live = null; return { sender: l.mainWc, senderFrame: l.mainFrame } }],
    ['no launch origin yet', () => { l.state.origin = null; return { sender: l.mainWc, senderFrame: l.mainFrame } }],
    ['a frame that is gone (senderFrame null)', () => ({ sender: l.mainWc, senderFrame: null })],
    ['the main frame itself, disposed (its every property throws)', () => {
      const gone = {}
      for (const k of ['origin', 'url']) Object.defineProperty(gone, k, { get() { throw new Error('Render frame was disposed before WebFrameMain could be accessed') } })
      l.mainWc.mainFrame = gone
      return { sender: l.mainWc, senderFrame: gone }
    }],
  ]
}
const REFUSED = refusedSenders(launch()).map(([name]) => name)

// ── the gate ─────────────────────────────────────────────────────────────────

describe('D3 — the gate: WILSON\'s page gets exactly what it got before', () => {
  it('an invoke from the main window\'s top frame at this launch\'s origin is the handler\'s own answer: a value, a promise, a throw', async () => {
    const { ipc, gate, mainWc, mainFrame } = gateOver()
    gate.handle('zoom-get', () => 0.5)
    gate.handle('wilson:session-load', async () => ({ access_token: 'made-up-access' }))
    gate.handle('rabbit:write-gdrive-config', () => { throw new Error('rabbit:write-gdrive-config: payload must be an object') })
    const ev = () => ({ sender: mainWc, senderFrame: mainFrame })
    expect(invoke(ipc, 'zoom-get', ev())).toBe(0.5)
    await expect(invoke(ipc, 'wilson:session-load', ev())).resolves.toEqual({ access_token: 'made-up-access' })
    expect(() => invoke(ipc, 'rabbit:write-gdrive-config', ev(), null)).toThrow('payload must be an object')
  })

  it('the handler is given the same event and arguments', () => {
    const { ipc, gate, mainWc, mainFrame } = gateOver()
    const fn = vi.fn(() => ({ ok: true }))
    gate.handle('rabbit:copy-file', fn)
    const e = { sender: mainWc, senderFrame: mainFrame }
    const opts = { sourcePath: 'C:/made-up/a.mov', destDir: 'C:/made-up/out', destFileName: 'a.mov' }
    invoke(ipc, 'rabbit:copy-file', e, opts)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toBe(e)
    expect(fn.mock.calls[0][1]).toBe(opts)
  })

  it('a synchronous message (the token) is answered by its listener once, and the gate adds nothing', () => {
    const { ipc, gate, mainWc, mainFrame, logged } = gateOver()
    gate.on('wilson:local-server-token', (event) => { event.returnValue = TOKEN })
    expect(message(ipc, 'wilson:local-server-token', { sender: mainWc, senderFrame: mainFrame }, true)).toEqual([TOKEN])
    expect(logged).toEqual([])
  })

  it('an asynchronous message reaches its listener with its arguments', () => {
    const { ipc, gate, mainWc, mainFrame } = gateOver()
    const fn = vi.fn()
    gate.on('wilson:renderer-storage-changes', fn)
    const changes = { set: [['k', 'v']], removed: [] }
    message(ipc, 'wilson:renderer-storage-changes', { sender: mainWc, senderFrame: mainFrame }, false, changes)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][1]).toBe(changes)
  })
})

describe('D3 — the gate: any other sender gets nothing, and is never left waiting', () => {
  it('each refused sender: an invoke resolves null, a synchronous message is answered null, an asynchronous one dropped; no handler runs', () => {
    expect(REFUSED).toHaveLength(7)
    for (const name of REFUSED) {
      const { ipc, gate, ...l } = gateOver()
      const sender = refusedSenders(l).find(([n]) => n === name)[1]
      const handler = vi.fn(() => ({ access_token: 'made-up-access' }))
      const syncListener = vi.fn((event) => { event.returnValue = TOKEN })
      const asyncListener = vi.fn()
      gate.handle('wilson:session-load', handler)
      gate.on('wilson:local-server-token', syncListener)
      gate.on('wilson:renderer-storage-changes', asyncListener)
      expect(invoke(ipc, 'wilson:session-load', sender()), name).toBeNull()
      expect(message(ipc, 'wilson:local-server-token', sender(), true), name).toEqual([null])
      expect(() => message(ipc, 'wilson:renderer-storage-changes', sender(), false, { set: [], removed: [] }), name).not.toThrow()
      expect(handler, name).not.toHaveBeenCalled()
      expect(syncListener, name).not.toHaveBeenCalled()
      expect(asyncListener, name).not.toHaveBeenCalled()
    }
  })

  it('a sender rule that throws is a refusal, answered all the same', () => {
    const { ipc, gate, mainWc, mainFrame } = gateOver({ accepts: () => { throw new Error('Object has been destroyed') } })
    const fn = vi.fn()
    gate.on('wilson:renderer-storage-seed', fn)
    expect(message(ipc, 'wilson:renderer-storage-seed', { sender: mainWc, senderFrame: mainFrame }, true)).toEqual([null])
    expect(fn).not.toHaveBeenCalled()
  })

  it('only a strict true accepts (a truthy answer is not a yes)', () => {
    const { ipc, gate, mainWc, mainFrame } = gateOver({ accepts: () => 'yes' })
    gate.handle('zoom-get', () => 0)
    expect(invoke(ipc, 'zoom-get', { sender: mainWc, senderFrame: mainFrame })).toBeNull()
  })

  it('the origin is read at each call: a new launch\'s port refuses the old page and answers the new one', () => {
    const { ipc, gate, mainWc, mainFrame, state } = gateOver()
    gate.handle('zoom-get', () => 1)
    state.origin = 'http://127.0.0.1:61234'
    expect(invoke(ipc, 'zoom-get', { sender: mainWc, senderFrame: mainFrame })).toBeNull()
    const relaunched = { origin: 'http://127.0.0.1:61234', url: 'http://127.0.0.1:61234/' }
    mainWc.mainFrame = relaunched
    expect(invoke(ipc, 'zoom-get', { sender: mainWc, senderFrame: relaunched })).toBe(1)
  })

  it('the answer comes before the log line: a log that throws still answers the refused page, and nothing reaches the caller', () => {
    const { ipc, gate } = gateOver({ log: () => { throw new Error('the console is gone') } })
    gate.on('wilson:local-server-token', (event) => { event.returnValue = TOKEN })
    gate.handle('wilson:session-load', () => ({}))
    const elsewhere = () => ({ sender: { mainFrame: {} }, senderFrame: { origin: 'file://', url: FILE_PAGE } })
    expect(message(ipc, 'wilson:local-server-token', elsewhere(), true)).toEqual([null])
    expect(invoke(ipc, 'wilson:session-load', elsewhere())).toBeNull()
  })
})

describe('D3 — the gate: the refusal\'s line names the channel and the scheme, nothing else, once', () => {
  it('a page that asks in a loop writes one line, not a thousand', () => {
    const { ipc, gate, logged } = gateOver()
    gate.handle('zoom-get', () => 0)
    for (let i = 0; i < 1000; i += 1) invoke(ipc, 'zoom-get', { sender: {}, senderFrame: { origin: 'file://', url: FILE_PAGE } })
    expect(logged).toHaveLength(1)
  })

  it('the lines, read back: the channel and the scheme, never the address, the port, a file\'s name or a value', () => {
    const { ipc, gate, logged } = gateOver()
    gate.handle('wilson:session-save', () => ({ ok: true }))
    gate.handle('zoom-get', () => 0)
    const fileEvent = () => ({ sender: {}, senderFrame: { origin: 'file://', url: FILE_PAGE } })
    const webEvent = () => ({ sender: {}, senderFrame: { origin: 'https://example.invalid', url: 'https://example.invalid/secret-invoice-0042.pdf?token=made-up' } })
    const session = { access_token: 'made-up-access', refresh_token: 'made-up-refresh' }
    invoke(ipc, 'wilson:session-save', fileEvent(), session)
    invoke(ipc, 'wilson:session-save', fileEvent(), session)
    invoke(ipc, 'wilson:session-save', webEvent(), session)
    invoke(ipc, 'zoom-get', fileEvent())
    expect(logged).toEqual([
      "[wilson] the bridge answers WILSON's page only: wilson:session-save was refused (the asking page's scheme: file:)",
      "[wilson] the bridge answers WILSON's page only: wilson:session-save was refused (the asking page's scheme: https:)",
      "[wilson] the bridge answers WILSON's page only: zoom-get was refused (the asking page's scheme: file:)",
    ])
    for (const line of logged) expect(line).not.toMatch(/secret|invoice|Users|example|60598|127\.0\.0\.1|made-up|token=|access/)
  })

  it('a frame that is gone is named unknown, and its page is still answered', () => {
    const { ipc, gate, logged, mainWc } = gateOver()
    gate.on('wilson:local-server-token', (event) => { event.returnValue = TOKEN })
    const gone = {}
    Object.defineProperty(gone, 'url', { get() { throw new Error('Render frame was disposed') } })
    expect(message(ipc, 'wilson:local-server-token', { sender: mainWc, senderFrame: gone }, true)).toEqual([null])
    expect(message(ipc, 'wilson:local-server-token', { sender: mainWc, senderFrame: null }, true)).toEqual([null])
    expect(logged).toEqual(["[wilson] the bridge answers WILSON's page only: wilson:local-server-token was refused (the asking page's scheme: unknown)"])
  })
})

describe('D3 — the window\'s first, empty document (measured on the build: it asks for the key at every launch)', () => {
  // MEASURED on a development build of 0f262874: 0.5 s into every launch the
  // main window's own top frame, still on its first document (no address,
  // origin 'null', the webContents' address empty), runs the preload and asks
  // for the key; on the tip it was handed it. Refused now; WILSON's page,
  // loading next in the same frame, is answered.
  it('is refused and answered null, its line names the scheme none; WILSON\'s page then gets its key', () => {
    const { ipc, gate, logged, mainWc } = gateOver()
    gate.on('wilson:local-server-token', (event) => { event.returnValue = TOKEN })
    const first = { origin: 'null', url: '' }
    mainWc.mainFrame = first
    expect(message(ipc, 'wilson:local-server-token', { sender: mainWc, senderFrame: first }, true)).toEqual([null])
    expect(logged).toEqual(["[wilson] the bridge answers WILSON's page only: wilson:local-server-token was refused (the asking page's scheme: none)"])
    const page = { origin: ORIGIN, url: `${ORIGIN}/` }
    mainWc.mainFrame = page
    expect(message(ipc, 'wilson:local-server-token', { sender: mainWc, senderFrame: page }, true)).toEqual([TOKEN])
    expect(logged).toHaveLength(1)
  })
})

describe('D3 — the gate: registration', () => {
  it('the rule is never asked at registration, only at each call', () => {
    const accepts = vi.fn(() => true)
    const { gate } = gateOver({ accepts })
    gate.handle('zoom-get', () => 0)
    gate.on('wilson:local-server-token', () => {})
    expect(accepts).not.toHaveBeenCalled()
  })

  it('a second listener for one message channel is refused at load, so a synchronous one is answered once; a second handler is Electron\'s own refusal, passed through', () => {
    const { gate } = gateOver()
    gate.on('wilson:local-server-token', () => {})
    expect(() => gate.on('wilson:local-server-token', () => {})).toThrow(/already has its listener/)
    gate.handle('zoom-get', () => 0)
    expect(() => gate.handle('zoom-get', () => 0)).toThrow(/second handler/)
  })

  it('it needs Electron\'s ipcMain, the rule and a function per channel; it carries its brand and cannot be changed', () => {
    expect(() => createIpcGate({ accepts: () => true })).toThrow(TypeError)
    expect(() => createIpcGate({ ipcMain: fakeIpcMain() })).toThrow(TypeError)
    expect(() => createIpcGate()).toThrow(TypeError)
    const { gate } = gateOver()
    expect(() => gate.handle('zoom-get')).toThrow(TypeError)
    expect(() => gate.on('wilson:renderer-storage-changes', null)).toThrow(TypeError)
    expect(gate.isGate).toBe(true)
    expect(Object.isFrozen(gate)).toBe(true)
    expect(() => { gate.handle = () => {} }).toThrow(TypeError)
    expect(Object.keys(gate).sort()).toEqual(['handle', 'isGate', 'on'])
  })
})

describe('D3 — electron/updater.cjs: its four channels go through the gate it is handed', () => {
  it('registered through the gate: WILSON\'s page is answered, another sender gets null', () => {
    const { ipc, gate, mainWc, mainFrame } = gateOver()
    initUpdater({ app: { isPackaged: false }, ipcMain: gate, getWebContents: () => null, getMainWindow: () => null })
    expect([...ipc.handlers.keys()].sort()).toEqual(['wilson:update-check', 'wilson:update-download', 'wilson:update-install', 'wilson:update-state'])
    expect(invoke(ipc, 'wilson:update-state', { sender: mainWc, senderFrame: mainFrame })).toEqual({ state: 'disabled', reason: 'dev' })
    expect(invoke(ipc, 'wilson:update-state', { sender: {}, senderFrame: { origin: 'file://', url: FILE_PAGE } })).toBeNull()
    expect(invoke(ipc, 'wilson:update-install', { sender: {}, senderFrame: { origin: 'file://', url: FILE_PAGE } })).toBeNull()
  })

  it('a registrar without the gate\'s brand (Electron\'s own ipcMain) is refused, and nothing is registered', () => {
    const raw = fakeIpcMain()
    expect(() => initUpdater({ app: { isPackaged: false }, ipcMain: raw, getWebContents: () => null, getMainWindow: () => null })).toThrow(/gate/)
    expect(() => initUpdater({ app: { isPackaged: false }, getWebContents: () => null, getMainWindow: () => null })).toThrow(/gate/)
    expect(raw.handlers.size).toBe(0)
  })
})

// ── the preload's one capability that never asks the main process ────────────
//
// Build review round 1, F2: `rabbit.getPathForFile` answers in the preload
// itself (webUtils), so the gate never saw it, and a page holding the preload
// without being WILSON's would still learn where a dropped file lives (a
// file's name is content). It now answers only when the main process answered
// the key, i.e. when the gate took this page for WILSON's.

/** The real preload, run whole in a VM whose `require` allows only what a sandboxed preload's does. */
function runPreloadWith(token) {
  const exposed = {}
  const asked = []
  const ipcRenderer = {
    sendSync: (channel) => (channel === 'wilson:local-server-token' ? token : null),
    send() {},
    invoke: async () => null,
    on() {},
    removeListener() {},
  }
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } },
    ipcRenderer,
    webUtils: { getPathForFile: (file) => { asked.push(file); return 'C:\\made-up\\folder\\clip-0042.mov' } },
  }
  const allowed = { electron, events: require('events'), timers: require('timers'), url: require('url') }
  const sandboxRequire = (name) => {
    if (!Object.hasOwn(allowed, name)) throw new Error(`a sandboxed preload cannot require '${name}'`)
    return allowed[name]
  }
  const win = { addEventListener() {} }
  Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError: an opaque origin') } })
  const context = vm.createContext({ require: sandboxRequire, window: win, document: { visibilityState: 'visible', addEventListener() {} }, console, setInterval: () => 0 })
  vm.runInContext(readFileSync(join(ELECTRON_DIR, 'preload.cjs'), 'utf8'), context, { filename: 'preload.cjs' })
  return { exposed, asked }
}

describe('D3 — the preload: a dropped file\'s place only for a page the main process answered as WILSON\'s (build review round 1, F2)', () => {
  it('WILSON\'s page (the key answered): the key, and the file\'s place', () => {
    const { exposed, asked } = runPreloadWith(TOKEN)
    expect(exposed.electronAPI.localServerToken).toBe(TOKEN)
    expect(exposed.electronAPI.rabbit.getPathForFile({ name: 'clip-0042.mov' })).toBe('C:\\made-up\\folder\\clip-0042.mov')
    expect(asked).toHaveLength(1)
  })
  it('any other page (the key answered null, or empty): no key, no place, and Electron is never asked', () => {
    for (const token of [null, '', undefined]) {
      const { exposed, asked } = runPreloadWith(token)
      expect(exposed.electronAPI.localServerToken ?? null, String(token)).toBe(token === '' ? '' : null)
      expect(exposed.electronAPI.rabbit.getPathForFile({ name: 'clip-0042.mov' }), String(token)).toBe('')
      expect(asked, String(token)).toEqual([])
    }
  })
  it('both bridges still exist on a refused page (it is answered with nothing, not broken)', () => {
    const { exposed } = runPreloadWith(null)
    expect(Object.keys(exposed).sort()).toEqual(['electronAPI', 'wilsonSession'])
    expect(typeof exposed.wilsonSession.load).toBe('function')
  })
})

// ── the source, parsed ───────────────────────────────────────────────────────
//
// What this proves, and what it does not (build review round 1, F1). Over
// every .cjs, .js and .mjs file under electron/, parsed (a comment is never
// code): Electron's module is loaded by main.cjs and the preload only, once
// each, and only by destructuring it (never held in a name, never read as a
// member); main.cjs takes `ipcMain` from it under another name and hands that
// name to the gate alone; every `require` names its module by a literal, and
// every relative one resolves inside the parsed set; no file reaches
// `ipcMain` as a member, a window's or frame's own `ipc`, or the raw IPC
// events, even through a computed name folded from literals; every
// registration in main.cjs and updater.cjs is on the gate. Then the channels
// the preload sends on equal the channels registered through the gate: that
// catches a channel added on one side without its pair. It does NOT catch a
// second listener on a channel the gate already holds, nor a name built at
// run time from a variable (`x[name]`); the rules above are what keep such a
// listener from reaching Electron's ipcMain in the first place. The repo only:
// a library in node_modules (Sentry, with a DSN) is OUTSTANDING D3-01.

const isCall = (n) => n && (n.type === 'CallExpression' || n.type === 'OptionalCallExpression')
const isMember = (n) => n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression')
const SKIP = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments'])

/** A string built only from literals ('ip' + 'c', `ipcMain`), folded; null for anything that needs a run. */
function folded(n) {
  if (!n) return null
  if (n.type === 'StringLiteral') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis.map((q) => q.value.cooked).join('')
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    const a = folded(n.left)
    const b = folded(n.right)
    return a !== null && b !== null ? a + b : null
  }
  return null
}
const propName = (m) => (!m.computed && m.property.type === 'Identifier' ? m.property.name : m.computed ? folded(m.property) : null)
const isRequire = (n) => isCall(n) && n.callee.type === 'Identifier' && n.callee.name === 'require'
const requiredName = (n) => (isRequire(n) && n.arguments.length === 1 ? folded(n.arguments[0]) : null)
const isElectronModule = (s) => s === 'electron' || (typeof s === 'string' && s.startsWith('electron/'))

/** Every node, with its parent and grandparent. */
function walk(node, visit, parent = null, grand = null) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent, grand)
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue
    const v = node[key]
    if (Array.isArray(v)) { for (const c of v) walk(c, visit, node, parent) } else if (v && typeof v.type === 'string') walk(v, visit, node, parent)
  }
}

/**
 * Is this Identifier a name in code (a binding or a reference), not an
 * object key or a member's property? A shorthand `{ ipcMain }` is two nodes
 * in Babel's tree, the key and its value: the value is the name.
 */
function isName(n, parent) {
  if (n.type !== 'Identifier') return false
  if (parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === n && !parent.computed) return false
  if (isMember(parent) && parent.property === n && !parent.computed) return false
  return true
}

const REGISTER = new Set(['handle', 'on'])
const LISTEN = new Set(['on', 'once', 'addListener', 'prependListener', 'prependOnceListener'])
const RAW_EVENTS = new Set(['ipc-message', 'ipc-message-sync', '-ipc-message', '-ipc-message-sync', '-ipc-invoke', 'web-contents-created'])
const SOURCE = /\.(cjs|js|mjs)$/

/** Does `spec`, required from `from` (both inside electron/), name a file in `files`, or a .json beside them? */
function resolvesInside(files, from, spec) {
  const base = resolve(ELECTRON_DIR, dirname(from), spec)
  const to = relative(ELECTRON_DIR, base)
  if (to.startsWith('..') || isAbsolute(to)) return 'outside'
  const rel = (p) => relative(ELECTRON_DIR, p).split('\\').join('/')
  for (const c of [base, `${base}.cjs`, `${base}.js`, `${base}.mjs`, join(base, 'index.cjs'), join(base, 'index.js')]) if (Object.hasOwn(files, rel(c))) return 'parsed'
  if (spec.endsWith('.json') && existsSync(base)) return 'parsed'
  return 'unread'
}

/**
 * The checker. `files` maps a path inside electron/ (forward slashes) to its
 * text, the preload included. Returns what it counted and every problem.
 */
function checkElectron(files) {
  const problems = []
  const counts = { main: 0, updater: 0 }
  const gated = new Set()
  const sent = new Set()
  const electronLoads = { 'main.cjs': 0, 'preload.cjs': 0 }
  for (const [name, text] of Object.entries(files)) {
    let ast
    try { ast = parser.parse(text, { sourceType: name.endsWith('.mjs') ? 'module' : 'script', allowReturnOutsideFunction: true }) } catch (e) { problems.push(`${name}: does not parse (${e.message})`); continue }
    const role = { 'main.cjs': 'main', 'updater.cjs': 'updater', 'ipcGate.cjs': 'gate', 'preload.cjs': 'preload' }[name] || 'other'
    const ipcMainNames = []
    const electronIpcMainNames = []
    let gateCalls = 0
    walk(ast.program, (n, parent, grand) => {
      // Every module named by a literal; dynamic import() not at all.
      if (n.type === 'Import' || n.type === 'ImportExpression') problems.push(`${name}: a dynamic import()`)
      if (isRequire(n)) {
        const spec = requiredName(n)
        if (spec === null) problems.push(`${name}: a require whose module is not named by a literal`)
        else if (isElectronModule(spec)) {
          if (role !== 'main' && role !== 'preload') problems.push(`${name}: requires Electron's module (only main.cjs and the preload do; hand a module what it needs, as windowGuard.cjs is handed shell.openExternal)`)
          else electronLoads[name] += 1
          if (!(parent?.type === 'VariableDeclarator' && parent.init === n && parent.id.type === 'ObjectPattern')) problems.push(`${name}: holds Electron's module instead of destructuring it`)
        } else if (spec.startsWith('.')) {
          const where = resolvesInside(files, name, spec)
          if (where === 'outside') problems.push(`${name}: requires a module outside electron/ (${spec})`)
          else if (where === 'unread') problems.push(`${name}: requires a module this parse does not read (${spec})`)
        }
      }
      if (n.type === 'ImportDeclaration' && isElectronModule(n.source.value)) problems.push(`${name}: imports Electron's module`)
      // What is taken from Electron's module.
      if (n.type === 'VariableDeclarator' && isRequire(n.init) && isElectronModule(requiredName(n.init)) && n.id.type === 'ObjectPattern') {
        for (const p of n.id.properties) {
          if (p.type === 'RestElement') { problems.push(`${name}: spreads Electron's exports`); continue }
          const key = !p.computed && p.key.type === 'Identifier' ? p.key.name : p.computed ? folded(p.key) : null
          if (key === null) problems.push(`${name}: takes a computed name from Electron`)
          if (key !== 'ipcMain') continue
          if (role !== 'main') problems.push(`${name}: takes ipcMain from Electron`)
          else if (p.value.type !== 'Identifier' || p.value.name !== 'electronIpcMain') problems.push(`${name}: takes Electron's ipcMain by its own name`)
        }
      }
      // Electron's ipcMain as a member; a window's or a frame's own ipc (consulted before ipcMain); the raw events.
      if (isMember(n) && propName(n) === 'ipcMain') problems.push(`${name}: reaches Electron's ipcMain as a member`)
      if (isMember(n) && propName(n) === 'ipc') problems.push(`${name}: reaches a window's or frame's own ipc`)
      if (isCall(n) && isMember(n.callee) && LISTEN.has(propName(n.callee)) && RAW_EVENTS.has(folded(n.arguments[0]))) problems.push(`${name}: listens for ${folded(n.arguments[0])}`)
      // Calls on a name `ipcMain`: registrations, counted.
      if (isCall(n) && isMember(n.callee) && n.callee.object.type === 'Identifier' && n.callee.object.name === 'ipcMain') {
        const method = propName(n.callee)
        if (!REGISTER.has(method)) problems.push(`${name}: calls ipcMain.${method}`)
        else if (role === 'main' || role === 'updater') {
          counts[role] += 1
          const ch = folded(n.arguments[0])
          if (ch !== null) gated.add(ch)
          else problems.push(`${name}: a channel not named by a literal`)
        } else if (role === 'gate') gateCalls += 1
        else problems.push(`${name}: registers on ipcMain`)
      }
      // The preload's channels.
      if (role === 'preload' && isCall(n) && isMember(n.callee) && n.callee.object.type === 'Identifier' && n.callee.object.name === 'ipcRenderer' && ['invoke', 'sendSync', 'send'].includes(propName(n.callee))) {
        const ch = folded(n.arguments[0])
        if (ch !== null) sent.add(ch)
        else problems.push('preload.cjs: a channel not named by a literal')
      }
      if (n.type === 'Identifier' && n.name === 'ipcMain' && isName(n, parent)) ipcMainNames.push({ n, parent, grand })
      if (n.type === 'Identifier' && n.name === 'electronIpcMain' && isName(n, parent)) electronIpcMainNames.push({ n, parent, grand })
    })

    const registrationObject = ({ parent, grand }) => isMember(parent) && parent.object.type === 'Identifier' && parent.object.name === 'ipcMain' && REGISTER.has(propName(parent)) && isCall(grand) && grand.callee === parent
    if (role === 'main') {
      const binding = ipcMainNames.filter(({ parent }) => parent?.type === 'VariableDeclarator' && parent.id.name === 'ipcMain')
      if (binding.length !== 1 || !(isCall(binding[0].parent.init) && binding[0].parent.init.callee.type === 'Identifier' && binding[0].parent.init.callee.name === 'createIpcGate')) {
        problems.push('main.cjs: `ipcMain` is not bound once, to createIpcGate(')
      }
      const handedToUpdater = ipcMainNames.filter(({ parent, grand }) => parent?.type === 'ObjectProperty' && parent.shorthand && grand?.type === 'ObjectExpression')
      const others = ipcMainNames.filter((u) => !binding.includes(u) && !handedToUpdater.includes(u) && !registrationObject(u))
      if (others.length) problems.push(`main.cjs: \`ipcMain\` used ${others.length} other way(s)`)
      if (handedToUpdater.length !== 1) problems.push('main.cjs: the gate is not handed to initUpdater once')
      const atRequire = electronIpcMainNames.filter(({ parent, grand }) => parent?.type === 'ObjectProperty' && grand?.type === 'ObjectPattern')
      const toGate = electronIpcMainNames.filter(({ parent, grand }) => parent?.type === 'ObjectProperty' && !parent.computed && parent.key.name === 'ipcMain' && grand?.type === 'ObjectExpression')
      if (electronIpcMainNames.length !== 2 || atRequire.length !== 1 || toGate.length !== 1) problems.push(`main.cjs: Electron's ipcMain named ${electronIpcMainNames.length} time(s), not once at the require and once handed to the gate`)
    } else if (role === 'updater') {
      const declared = ipcMainNames.filter(({ parent }) => parent?.type === 'VariableDeclarator' && parent.id.name === 'ipcMain' && parent.init?.type === 'NullLiteral')
      const setFromGate = ipcMainNames.filter(({ parent }) => parent?.type === 'AssignmentExpression' && parent.left.name === 'ipcMain' && parent.right.type === 'Identifier' && parent.right.name === 'gate')
      const others = ipcMainNames.filter((u) => !declared.includes(u) && !setFromGate.includes(u) && !registrationObject(u))
      if (declared.length !== 1 || setFromGate.length !== 1 || others.length) problems.push('updater.cjs: `ipcMain` is not the gate initUpdater is handed')
    } else if (role === 'gate') {
      if (gateCalls !== 2) problems.push(`ipcGate.cjs: ${gateCalls} raw registration(s), not its own handle and on`)
    } else if (ipcMainNames.length) problems.push(`${name}: names ipcMain`)
    if (role !== 'main' && electronIpcMainNames.length) problems.push(`${name}: names electronIpcMain`)
  }
  for (const [file, n] of Object.entries(electronLoads)) if (n !== 1) problems.push(`${file}: loads Electron's module ${n} time(s), not once`)
  // The pairing: the preload's channels and the gated ones, each with its pair.
  const missing = [...sent].filter((c) => !gated.has(c))
  const extra = [...gated].filter((c) => !sent.has(c))
  if (missing.length) problems.push(`preload channels not registered through the gate: ${missing.join(', ')}`)
  if (extra.length) problems.push(`gated channels the preload never sends on: ${extra.join(', ')}`)
  return { problems, counts, channels: gated.size, preloadChannels: sent.size }
}

/** Every source file under `root` (electron/), sub-folders included, by its path inside it. */
function electronSources(root = ELECTRON_DIR, dir = root, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) electronSources(root, p, out)
    else if (SOURCE.test(e.name)) out[relative(root, p).split('\\').join('/')] = readFileSync(p, 'utf8')
  }
  return out
}
const ELECTRON_FILES = electronSources()

describe('D3 — the reader: every source file, sub-folders included (round 1, F1)', () => {
  it('reads .cjs, .js and .mjs at any depth, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'd3-reader-'))
    try {
      mkdirSync(join(dir, 'lib', 'deep'), { recursive: true })
      for (const f of ['a.cjs', 'lib/b.js', 'lib/deep/c.mjs', 'notes.md', 'lib/data.json']) writeFileSync(join(dir, f), '// x\n')
      expect(Object.keys(electronSources(dir)).sort()).toEqual(['a.cjs', 'lib/b.js', 'lib/deep/c.mjs'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('D3 — the source: no channel is registered past the gate', () => {
  it('every source file under electron/, parsed: no problem; 46 registrations in main.cjs, 7 in updater.cjs, 50 channels, the preload\'s 50 the same', () => {
    const r = checkElectron(ELECTRON_FILES)
    expect(r.problems).toEqual([])
    expect(r.counts).toEqual({ main: 46, updater: 7 })
    expect(r.channels).toBe(50)
    expect(r.preloadChannels).toBe(50)
    expect(Object.keys(ELECTRON_FILES)).toEqual(expect.arrayContaining(['ipcGate.cjs', 'main.cjs', 'updater.cjs', 'preload.cjs']))
  })

  it('main.cjs makes the gate before its first registration, with D1\'s rule read at each call', () => {
    const main = ELECTRON_FILES['main.cjs'].replace(/\r\n/g, '\n')
    expect(main).toContain("const { app, BrowserWindow, ipcMain: electronIpcMain, shell, dialog, safeStorage, session } = require('electron');")
    const made = main.indexOf('const ipcMain = createIpcGate({\n  ipcMain: electronIpcMain,\n  accepts: (event) => fromThisLaunchsPage(event),\n  log: (line) => console.warn(line),\n});')
    expect(made).toBeGreaterThan(-1)
    expect(made).toBeLessThan(main.indexOf("ipcMain.handle('wilson:sentry-test'"))
    expect(main).toContain('return acceptsSender(event, { webContents: live, origin: localServerOrigin });')
    expect(main).toMatch(/initUpdater\(\{\n\s+app,\n(\s+\/\/[^\n]*\n)*\s+ipcMain,\n/)
  })

  describe('the checker\'s controls: each must fail', () => {
    const swap = (name, from, to) => {
      const text = ELECTRON_FILES[name]
      if (!text.includes(from)) throw new Error(`control: ${from} not found in ${name}`)
      return { ...ELECTRON_FILES, [name]: text.replace(from, to) }
    }
    const MAIN_ANCHOR = "const express = require('express');"
    const problemsOf = (files) => checkElectron(files).problems.join('\n')
    it('one registration made bare, on Electron\'s own ipcMain', () => {
      const p = problemsOf(swap('main.cjs', "ipcMain.handle('wilson:sentry-test'", "electronIpcMain.handle('wilson:sentry-test'"))
      expect(p).toMatch(/Electron's ipcMain named 3 time/)
      expect(p).toMatch(/not registered through the gate: wilson:sentry-test/)
    })
    it('updater.cjs taking Electron\'s ipcMain again, at load or lazily', () => {
      expect(problemsOf(swap('updater.cjs', 'let ipcMain = null;', "const { ipcMain } = require('electron');"))).toMatch(/updater\.cjs: requires Electron's module/)
      expect(problemsOf(swap('updater.cjs', 'let ipcMain = null;', "let ipcMain = null;\nconst raw = () => require('electron').ipcMain;"))).toMatch(/updater\.cjs: (requires Electron's module|holds Electron's module)/)
    })
    it('Electron\'s module held in a name and destructured later, in a new file or in main.cjs (round 1, F1)', () => {
      const rogue = "const e = require('electron');\nconst { ipcMain: raw } = e;\nraw.on('wilson:local-server-token', (ev) => { ev.returnValue = 'x'; });\n"
      const p = problemsOf({ ...ELECTRON_FILES, 'rogue.cjs': rogue })
      expect(p).toMatch(/rogue\.cjs: requires Electron's module/)
      expect(p).toMatch(/rogue\.cjs: holds Electron's module instead of destructuring it/)
      const inMain = problemsOf(swap('main.cjs', MAIN_ANCHOR, `const e = require('electron');\n${MAIN_ANCHOR}`))
      expect(inMain).toMatch(/main\.cjs: holds Electron's module/)
      expect(inMain).toMatch(/main\.cjs: loads Electron's module 2 time/)
    })
    it('electron/main instead of electron, and a computed name folded from literals (round 1, F1)', () => {
      expect(problemsOf({ ...ELECTRON_FILES, 'rogue.cjs': "const { ipcMain: raw2 } = require('electron/main');\nraw2.on('x', () => {});\n" })).toMatch(/rogue\.cjs: requires Electron's module/)
      const computed = problemsOf({ ...ELECTRON_FILES, 'rogue.cjs': "require('electron')['ipc' + 'Main'].on('wilson:local-server-token', (ev) => { ev.returnValue = 'x'; });\n" })
      expect(computed).toMatch(/rogue\.cjs: reaches Electron's ipcMain as a member/)
      expect(computed).toMatch(/rogue\.cjs: holds Electron's module/)
      expect(problemsOf({ ...ELECTRON_FILES, 'rogue.cjs': "module.exports = (win) => win.webContents['ip' + 'c'].handle('wilson:session-load', () => ({}));\n" })).toMatch(/rogue\.cjs: reaches a window's or frame's own ipc/)
    })
    it('a module in a sub-folder, a .js module, one main.cjs requires that this parse does not read, and a require not named by a literal (round 1, F1)', () => {
      const rogue = "const { ipcMain } = require('electron');\nipcMain.on('wilson:local-server-token', (ev) => { ev.returnValue = 'x'; });\n"
      expect(problemsOf({ ...swap('main.cjs', MAIN_ANCHOR, `require('./lib/rogue.cjs');\n${MAIN_ANCHOR}`), 'lib/rogue.cjs': rogue })).toMatch(/lib\/rogue\.cjs: requires Electron's module/)
      expect(problemsOf({ ...ELECTRON_FILES, 'rogue.js': rogue })).toMatch(/rogue\.js: takes ipcMain from Electron/)
      expect(problemsOf(swap('main.cjs', MAIN_ANCHOR, `require('./lib/not-read.cjs');\n${MAIN_ANCHOR}`))).toMatch(/requires a module this parse does not read \(\.\/lib\/not-read\.cjs\)/)
      expect(problemsOf(swap('main.cjs', MAIN_ANCHOR, `require(path.join(__dirname, '..', 'scripts', 'rogue.cjs'));\n${MAIN_ANCHOR}`))).toMatch(/a require whose module is not named by a literal/)
      expect(problemsOf(swap('main.cjs', MAIN_ANCHOR, `require('../scripts/elsewhere.cjs');\n${MAIN_ANCHOR}`))).toMatch(/outside electron\//)
    })
    it('a module answering on a window\'s own ipc, or listening for the raw events', () => {
      expect(problemsOf({ ...ELECTRON_FILES, 'rogue.cjs': "module.exports = (win) => win.webContents.ipc.handle('wilson:session-load', () => ({}));\n" })).toMatch(/rogue\.cjs: reaches a window's or frame's own ipc/)
      const raw = problemsOf({ ...ELECTRON_FILES, 'rogue.cjs': "module.exports = (app) => { app.on('web-contents-created', (_e, wc) => { wc.on('ipc-message', () => {}); }); };\n" })
      expect(raw).toMatch(/listens for web-contents-created/)
      expect(raw).toMatch(/listens for ipc-message/)
    })
    it('Electron\'s ipcMain named twice in main.cjs', () => {
      expect(problemsOf(swap('main.cjs', MAIN_ANCHOR, `const { ipcMain: second } = require('electron');\n${MAIN_ANCHOR}`))).toMatch(/takes Electron's ipcMain by its own name/)
    })
    it('and a registration written in a comment is not code: nothing counted, nothing wrong', () => {
      const r = checkElectron(swap('main.cjs', MAIN_ANCHOR, `// ipcMain.handle('d3-in-a-comment', () => 1)\n/* electronIpcMain.on('d3-in-a-block', () => {}) */\n${MAIN_ANCHOR}`))
      expect(r.problems).toEqual([])
      expect(r.counts.main).toBe(46)
    })
  })
})
