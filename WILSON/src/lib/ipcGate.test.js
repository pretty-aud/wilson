// =============================================================================
// ipcGate.test.js — D3 (night 7, 2026-10-29; docs/design/RECONNECT_DESIGN.md
// §14; OUTSTANDING D2-02): every channel the preload bridges answers WILSON's
// own page and nobody else.
//
// Three parts, each through the real code:
//   * electron/ipcGate.cjs — the gate over stand-ins (an ipcMain that records,
//     webContents and frames as plain objects), composed with D1's real
//     acceptsSender exactly as main.cjs's fromThisLaunchsPage composes it;
//   * electron/updater.cjs — loaded for real (it no longer requires Electron)
//     and handed the gate: its four channels go through it, and a registrar
//     without the gate's brand is refused;
//   * the source of every electron/*.cjs and of the preload, PARSED
//     (@babel/parser, so a comment is never code): main.cjs's `ipcMain` is the
//     gate, Electron's is named once and handed to it; no file reaches
//     Electron's ipcMain, a window's or frame's own ipc, or the raw IPC events
//     Electron consults first; and the channels the preload sends on are
//     exactly the channels registered through the gate. That equality is the
//     backstop: a registration the parse somehow missed would leave the gated
//     set one short. The checker's controls (a bare registration, the updater
//     requiring Electron's again, a module on webContents.ipc or listening for
//     ipc-message) run here too, and each must fail. The repo only: a library
//     in node_modules registering on Electron's ipcMain (Sentry, with a DSN)
//     is recorded in OUTSTANDING D3-01, not seen here.
// Measured on the tip bb14b169 (a development build, a scratch userData): a
// page holding the preload that was not WILSON's was handed the local
// server's key, the session and every channel but D1's storage and D2's
// download. The desktop run on the build is RECONNECT_DESIGN.md §14.7.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ── the source, parsed ───────────────────────────────────────────────────────

const PARSE = { sourceType: 'script', allowReturnOutsideFunction: true }
const isCall = (n) => n && (n.type === 'CallExpression' || n.type === 'OptionalCallExpression')
const isMember = (n) => n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression')
const propName = (m) => (!m.computed && m.property.type === 'Identifier' ? m.property.name : m.computed && m.property.type === 'StringLiteral' ? m.property.value : null)
const isRequireOf = (n, what) => isCall(n) && n.callee.type === 'Identifier' && n.callee.name === 'require' && n.arguments[0]?.type === 'StringLiteral' && (what === undefined || n.arguments[0].value === what)
const SKIP = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments'])

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
const FORBIDDEN_IPCMAIN = new Set(['once', 'handleOnce', 'addListener', 'prependListener', 'prependOnceListener', 'removeHandler', 'removeListener', 'removeAllListeners', 'off', 'emit'])
const LISTEN = new Set(['on', 'once', 'addListener', 'prependListener', 'prependOnceListener'])
const RAW_EVENTS = new Set(['ipc-message', 'ipc-message-sync', '-ipc-message', '-ipc-message-sync', '-ipc-invoke', 'web-contents-created'])

/**
 * The checker. `files` maps a file name in electron/ to its text; `preload`
 * is preload.cjs's. Returns what it counted and every problem it found.
 */
function checkElectron(files, preload) {
  const problems = []
  const counts = { main: 0, updater: 0 }
  const gated = new Set()
  for (const [name, text] of Object.entries(files)) {
    let ast
    try { ast = parser.parse(text, PARSE) } catch (e) { problems.push(`${name}: does not parse (${e.message})`); continue }
    const role = name === 'main.cjs' ? 'main' : name === 'updater.cjs' ? 'updater' : name === 'ipcGate.cjs' ? 'gate' : 'other'
    const ipcMainNames = []
    const electronIpcMainNames = []
    let gateCalls = 0
    walk(ast.program, (n, parent, grand) => {
      // Electron's ipcMain, by any member access (`require('electron').ipcMain`, `electron.ipcMain`).
      if (isMember(n) && propName(n) === 'ipcMain') problems.push(`${name}: reaches Electron's ipcMain as a member`)
      // A window's or a frame's own ipc, consulted by Electron before ipcMain.
      if (isMember(n) && propName(n) === 'ipc') problems.push(`${name}: reaches a window's or frame's own ipc`)
      // The raw IPC events, and the hook that would reach every new window's.
      if (isCall(n) && isMember(n.callee) && LISTEN.has(propName(n.callee)) && n.arguments[0]?.type === 'StringLiteral' && RAW_EVENTS.has(n.arguments[0].value)) {
        problems.push(`${name}: listens for ${n.arguments[0].value}`)
      }
      // Electron's require: only main.cjs takes ipcMain from it, and only by another name.
      if (n.type === 'VariableDeclarator' && isRequireOf(n.init, 'electron') && n.id.type === 'ObjectPattern') {
        for (const p of n.id.properties) {
          const key = p.type === 'ObjectProperty' && !p.computed && p.key.type === 'Identifier' ? p.key.name : null
          if (key !== 'ipcMain') continue
          if (role !== 'main') problems.push(`${name}: takes ipcMain from Electron`)
          else if (p.value.type !== 'Identifier' || p.value.name !== 'electronIpcMain') problems.push(`${name}: takes Electron's ipcMain by its own name`)
        }
      }
      if (n.type === 'RestElement' && parent?.type === 'ObjectPattern' && grand?.type === 'VariableDeclarator' && isRequireOf(grand.init, 'electron')) problems.push(`${name}: spreads Electron's exports`)
      // Relative requires stay inside electron/ (so this parse sees every module main loads).
      if (isRequireOf(n) && n.arguments[0].value.startsWith('.')) {
        const to = relative(ELECTRON_DIR, resolve(ELECTRON_DIR, n.arguments[0].value))
        if (to.startsWith('..') || isAbsolute(to)) problems.push(`${name}: requires a module outside electron/ (${n.arguments[0].value})`)
      }
      // Calls on a name `ipcMain`.
      if (isCall(n) && isMember(n.callee) && n.callee.object.type === 'Identifier' && n.callee.object.name === 'ipcMain') {
        const method = propName(n.callee)
        if (FORBIDDEN_IPCMAIN.has(method) || !REGISTER.has(method)) problems.push(`${name}: calls ipcMain.${method}`)
        else if (role === 'main' || role === 'updater') {
          counts[role] += 1
          const ch = n.arguments[0]
          if (ch?.type === 'StringLiteral') gated.add(ch.value)
          else problems.push(`${name}: a channel not named by a literal`)
        } else if (role === 'gate') {
          gateCalls += 1
        } else problems.push(`${name}: registers on ipcMain`)
      }
      if (n.type === 'Identifier' && n.name === 'ipcMain' && isName(n, parent)) ipcMainNames.push({ n, parent, grand })
      if (n.type === 'Identifier' && n.name === 'electronIpcMain' && isName(n, parent)) electronIpcMainNames.push({ n, parent, grand })
      if (n.type === 'Identifier' && n.name === 'ipcMain' && role === 'other') problems.push(`${name}: names ipcMain`)
    })

    const registrationObject = ({ parent, grand }) => isMember(parent) && parent.object.type === 'Identifier' && parent.object.name === 'ipcMain' && REGISTER.has(propName(parent)) && isCall(grand) && grand.callee === parent
    if (role === 'main') {
      // `ipcMain` is bound once, to the gate; used only to register, and handed to initUpdater.
      const binding = ipcMainNames.filter(({ parent }) => parent?.type === 'VariableDeclarator' && parent.id.name === 'ipcMain')
      if (binding.length !== 1 || !(isCall(binding[0].parent.init) && binding[0].parent.init.callee.type === 'Identifier' && binding[0].parent.init.callee.name === 'createIpcGate')) {
        problems.push('main.cjs: `ipcMain` is not bound once, to createIpcGate(')
      }
      const handedToUpdater = ipcMainNames.filter(({ parent, grand }) => parent?.type === 'ObjectProperty' && parent.shorthand && grand?.type === 'ObjectExpression')
      const others = ipcMainNames.filter((u) => !binding.includes(u) && !handedToUpdater.includes(u) && !registrationObject(u))
      if (others.length) problems.push(`main.cjs: \`ipcMain\` used ${others.length} other way(s)`)
      if (handedToUpdater.length !== 1) problems.push('main.cjs: the gate is not handed to initUpdater once')
      // Electron's own: named twice — at the require, and handed to the gate.
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
    }
    if (role !== 'main' && electronIpcMainNames.length) problems.push(`${name}: names electronIpcMain`)
  }
  // The backstop: the preload's channels are exactly the gated ones.
  const sent = new Set()
  walk(parser.parse(preload, PARSE).program, (n) => {
    if (isCall(n) && isMember(n.callee) && n.callee.object.type === 'Identifier' && n.callee.object.name === 'ipcRenderer' && ['invoke', 'sendSync', 'send'].includes(propName(n.callee))) {
      if (n.arguments[0]?.type === 'StringLiteral') sent.add(n.arguments[0].value)
      else problems.push('preload.cjs: a channel not named by a literal')
    }
  })
  const missing = [...sent].filter((c) => !gated.has(c))
  const extra = [...gated].filter((c) => !sent.has(c))
  if (missing.length) problems.push(`preload channels not registered through the gate: ${missing.join(', ')}`)
  if (extra.length) problems.push(`gated channels the preload never sends on: ${extra.join(', ')}`)
  return { problems, counts, channels: gated.size, preloadChannels: sent.size }
}

const ELECTRON_FILES = Object.fromEntries(readdirSync(ELECTRON_DIR).filter((f) => f.endsWith('.cjs') && f !== 'preload.cjs').map((f) => [f, readFileSync(join(ELECTRON_DIR, f), 'utf8')]))
const PRELOAD = readFileSync(join(ELECTRON_DIR, 'preload.cjs'), 'utf8')

describe('D3 — the source: no channel is registered past the gate', () => {
  it('every electron/*.cjs, parsed: no problem; 46 registrations in main.cjs, 7 in updater.cjs, 50 channels, the preload\'s 50 the same', () => {
    const r = checkElectron(ELECTRON_FILES, PRELOAD)
    expect(r.problems).toEqual([])
    expect(r.counts).toEqual({ main: 46, updater: 7 })
    expect(r.channels).toBe(50)
    expect(r.preloadChannels).toBe(50)
    expect(Object.keys(ELECTRON_FILES)).toContain('ipcGate.cjs')
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
    it('one registration made bare, on Electron\'s own ipcMain', () => {
      const r = checkElectron(swap('main.cjs', "ipcMain.handle('wilson:sentry-test'", "electronIpcMain.handle('wilson:sentry-test'"), PRELOAD)
      expect(r.problems.join('\n')).toMatch(/Electron's ipcMain named 3 time/)
      expect(r.problems.join('\n')).toMatch(/not registered through the gate: wilson:sentry-test/)
    })
    it('updater.cjs requiring Electron\'s ipcMain again', () => {
      const r = checkElectron(swap('updater.cjs', 'let ipcMain = null;', "const { ipcMain } = require('electron');"), PRELOAD)
      expect(r.problems.join('\n')).toMatch(/updater\.cjs: takes ipcMain from Electron/)
    })
    it('a module answering on a window\'s own ipc, or listening for the raw events', () => {
      const one = checkElectron({ ...ELECTRON_FILES, 'rogue.cjs': "module.exports = (win) => win.webContents.ipc.handle('wilson:session-load', () => ({}));\n" }, PRELOAD)
      expect(one.problems.join('\n')).toMatch(/rogue\.cjs: reaches a window's or frame's own ipc/)
      const two = checkElectron({ ...ELECTRON_FILES, 'rogue.cjs': "const { app } = require('electron');\napp.on('web-contents-created', (_e, wc) => { wc.on('ipc-message', () => {}); });\n" }, PRELOAD)
      expect(two.problems.join('\n')).toMatch(/listens for web-contents-created/)
      expect(two.problems.join('\n')).toMatch(/listens for ipc-message/)
    })
    it('Electron\'s ipcMain reached as a member, or named twice in main.cjs', () => {
      const member = checkElectron({ ...ELECTRON_FILES, 'rogue.cjs': "require('electron').ipcMain.on('wilson:local-server-token', (e) => { e.returnValue = 'x'; });\n" }, PRELOAD)
      expect(member.problems.join('\n')).toMatch(/rogue\.cjs: reaches Electron's ipcMain as a member/)
      const twice = checkElectron(swap('main.cjs', "const express = require('express');", "const { ipcMain: second } = require('electron');\nconst express = require('express');"), PRELOAD)
      expect(twice.problems.join('\n')).toMatch(/takes Electron's ipcMain by its own name/)
    })
    it('a module required from outside electron/', () => {
      const r = checkElectron(swap('main.cjs', "const express = require('express');", "require('../scripts/elsewhere.cjs');\nconst express = require('express');"), PRELOAD)
      expect(r.problems.join('\n')).toMatch(/outside electron\//)
    })
    it('and a registration written in a comment is not code: nothing counted, nothing wrong', () => {
      const r = checkElectron(swap('main.cjs', "const express = require('express');", "// ipcMain.handle('d3-in-a-comment', () => 1)\n/* electronIpcMain.on('d3-in-a-block', () => {}) */\nconst express = require('express');"), PRELOAD)
      expect(r.problems).toEqual([])
      expect(r.counts.main).toBe(46)
    })
  })
})
