// =============================================================================
// windowGuard.test.js — D2 (night 6, 2026-10-29; docs/design/
// RECONNECT_DESIGN.md §13.2; OUTSTANDING D1-01): the main window, and each
// window it opens, loads WILSON's own page and nothing else.
//
// Two parts, through the real code:
//   * electron/windowGuard.cjs — the rules (what is the launch's own page,
//     what window.open gets) and their wiring, driven with a stand-in
//     webContents that records what Electron would be told;
//   * electron/main.cjs's calls, read from source (it requires Electron at
//     load): the guard on the main window and on every window it opens,
//     `navigateOnDragDrop: false`, no `nodeIntegrationInSubFrames`, and the
//     old handler that allowed every non-http window gone.
// Measured on the tip 4728a92d (a development build, a scratch userData): a
// page that sent itself to another site landed there with the saved sign-in
// and the local server's key; the desktop run on the build is in §13.7.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { staysOnOwnPage, openDecision, guardWindow, isDownloadAddress } = require('../../electron/windowGuard.cjs')

const here = dirname(fileURLToPath(import.meta.url))
const MAIN = readFileSync(resolve(here, '../../electron/main.cjs'), 'utf8').replace(/\r\n/g, '\n')

const ORIGIN = 'http://127.0.0.1:60589'
const FILE = 'file:///C:/Users/someone/Documents/secret-invoice-0042.pdf'

/** A stand-in webContents: the handlers Electron would hold, and what was opened and logged. */
function standIn({ origin = ORIGIN, child = false, refuseBrowser = false } = {}) {
  const handlers = {}
  let openHandler = null
  const opened = []
  const logged = []
  let current = origin
  const wc = {
    on: (name, fn) => { handlers[name] = fn },
    setWindowOpenHandler: (fn) => { openHandler = fn },
  }
  guardWindow(wc, {
    origin: () => current,
    openExternal: (url) => { if (refuseBrowser) throw new Error('no browser'); opened.push(url) },
    log: (line) => logged.push(line),
    child,
  })
  const navEvent = (url, extra = {}) => {
    const e = { url, prevented: false, preventDefault() { this.prevented = true }, ...extra }
    return e
  }
  return {
    opened, logged,
    setOrigin: (o) => { current = o },
    navigate(url) { const e = navEvent(url); handlers['will-navigate'](e, url); return e.prevented ? 'refused' : 'allowed' },
    redirect(url, isMainFrame = true) { const e = navEvent(url, { isMainFrame }); handlers['will-redirect'](e, url, false, isMainFrame); return e.prevented ? 'refused' : 'allowed' },
    open(url) { return openHandler({ url, frameName: '', features: '', disposition: 'new-window' }).action },
    handlers: () => Object.keys(handlers).sort(),
  }
}

describe('D2 — staysOnOwnPage: the launch\'s own page and nothing else', () => {
  it('the launch\'s origin with any path, query or hash stays (the strip\'s Reload, the workspace switcher)', () => {
    for (const url of [ORIGIN, `${ORIGIN}/`, `${ORIGIN}/?workspace=w2`, `${ORIGIN}/#/rabbit`, `${ORIGIN}/index.html?x=1#y`]) {
      expect(staysOnOwnPage(url, ORIGIN), url).toBe(true)
    }
  })

  it('anything else is refused: a file, another site, another port, localhost at the same port, a blob:, about:, data:, javascript:, junk', () => {
    for (const url of [
      FILE, 'file:///C:/', 'https://example.com/', 'http://example.com/', 'http://127.0.0.1:60590/', 'https://127.0.0.1:60589/',
      'http://localhost:60589/', `blob:${ORIGIN}/7f1c2a6e-0000-4000-8000-000000000001`, 'about:blank', 'data:text/html,<p>x</p>',
      'javascript:alert(1)', 'chrome://settings', 'ms-settings:privacy', '', 'not a url', null, undefined,
    ]) {
      expect(staysOnOwnPage(url, ORIGIN), String(url)).toBe(false)
    }
  })

  it('no launch origin yet, or an origin of "null", refuses everything', () => {
    for (const origin of [null, undefined, '', 'null']) expect(staysOnOwnPage(`${ORIGIN}/`, origin), String(origin)).toBe(false)
  })

  it('a window the page opened: its two starting points too (about:blank, a blob: of the launch\'s origin), never another blob: or a file', () => {
    expect(staysOnOwnPage('about:blank', ORIGIN, { child: true })).toBe(true)
    expect(staysOnOwnPage(`blob:${ORIGIN}/7f1c2a6e-0000-4000-8000-000000000001`, ORIGIN, { child: true })).toBe(true)
    expect(staysOnOwnPage(`${ORIGIN}/`, ORIGIN, { child: true })).toBe(true)
    for (const url of ['blob:http://127.0.0.1:60590/7f1c', 'blob:https://example.com/7f1c', FILE, 'about:blank#x', 'about:srcdoc', 'https://example.com/']) {
      expect(staysOnOwnPage(url, ORIGIN, { child: true }), url).toBe(false)
    }
  })

  it('Node reads a blob: address\'s origin as its inner one (why the scheme is checked first)', () => {
    expect(new URL(`blob:${ORIGIN}/abc`).origin).toBe(ORIGIN)
  })
})

describe('D2 — openDecision: what window.open gets', () => {
  it('http and https go to the system browser and no window opens, as before', () => {
    for (const url of ['https://example.com/guide', 'http://example.com/', `${ORIGIN}/api/x`]) expect(openDecision(url, ORIGIN), url).toEqual({ action: 'deny', external: true })
  })

  it('the print window (about:blank) and the page\'s own blob: addresses open', () => {
    expect(openDecision('about:blank', ORIGIN)).toEqual({ action: 'allow', external: false })
    expect(openDecision(`blob:${ORIGIN}/7f1c2a6e-0000-4000-8000-000000000001`, ORIGIN)).toEqual({ action: 'allow', external: false })
  })

  it('everything else is refused and handed to nothing: a file (never the system\'s file handler), data:, javascript:, another origin\'s blob:, any other scheme, junk', () => {
    for (const url of [FILE, 'data:text/html,<p>x</p>', 'javascript:alert(1)', 'blob:http://127.0.0.1:60590/x', 'ms-settings:privacy', 'tel:+15550100', 'about:blank#x', 'not a url', '']) {
      expect(openDecision(url, ORIGIN), url).toEqual({ action: 'deny', external: false })
    }
    expect(openDecision(`blob:${ORIGIN}/x`, null)).toEqual({ action: 'deny', external: false })
  })

  it('a window the page opened opens none of its own: http(s) to the system browser, the rest refused', () => {
    expect(openDecision('https://example.com/', ORIGIN, { child: true })).toEqual({ action: 'deny', external: true })
    for (const url of ['about:blank', `blob:${ORIGIN}/x`, FILE]) expect(openDecision(url, ORIGIN, { child: true }), url).toEqual({ action: 'deny', external: false })
  })
})

describe('D2 — guardWindow: the rules wired to a window', () => {
  it('a navigation to a file, or to another site, is refused; another site goes to the system browser, a file to nothing', () => {
    const w = standIn()
    expect(w.navigate(FILE)).toBe('refused')
    expect(w.navigate('https://example.com/elsewhere')).toBe('refused')
    expect(w.navigate('data:text/html,x')).toBe('refused')
    expect(w.opened).toEqual(['https://example.com/elsewhere'])
  })

  it('the launch\'s own page is never refused, at the origin read at the moment (a new port at every launch)', () => {
    const w = standIn()
    expect(w.navigate(`${ORIGIN}/?workspace=w2`)).toBe('allowed')
    w.setOrigin('http://127.0.0.1:61234')
    expect(w.navigate(`${ORIGIN}/`)).toBe('refused')
    expect(w.navigate('http://127.0.0.1:61234/#/x')).toBe('allowed')
    w.setOrigin(null)
    expect(w.navigate('http://127.0.0.1:61234/')).toBe('refused')
  })

  it('a top-frame redirect elsewhere is refused and opens nothing; a frame\'s own redirect is not the guard\'s', () => {
    const w = standIn()
    expect(w.redirect('https://example.com/')).toBe('refused')
    expect(w.redirect(`${ORIGIN}/api/thing`)).toBe('allowed')
    expect(w.redirect('https://example.com/', false)).toBe('allowed')
    expect(w.opened).toEqual([])
  })

  it('window.open through the wiring: http(s) to the system browser, the print window and own blob: open, a file is refused', () => {
    const w = standIn()
    expect(w.open('https://example.com/source')).toBe('deny')
    expect(w.open('about:blank')).toBe('allow')
    expect(w.open(`blob:${ORIGIN}/x`)).toBe('allow')
    expect(w.open(FILE)).toBe('deny')
    expect(w.opened).toEqual(['https://example.com/source'])
  })

  it('a window the page opened: its own page stays, a link in it goes to the system browser, it opens no window', () => {
    const c = standIn({ child: true })
    expect(c.navigate('about:blank')).toBe('allowed')
    expect(c.navigate(`blob:${ORIGIN}/x`)).toBe('allowed')
    expect(c.navigate('https://example.com/link-in-a-receipt')).toBe('refused')
    expect(c.open('about:blank')).toBe('deny')
    expect(c.open('https://example.com/')).toBe('deny')
    expect(c.opened).toEqual(['https://example.com/link-in-a-receipt', 'https://example.com/'])
  })

  it('a system browser that refuses changes nothing: still refused, nothing thrown', () => {
    const w = standIn({ refuseBrowser: true })
    expect(w.navigate('https://example.com/')).toBe('refused')
    expect(w.open('https://example.com/')).toBe('deny')
  })

  it('a refusal is logged by its scheme only: never the address, which can carry a file\'s name', () => {
    const w = standIn()
    w.navigate(FILE)
    w.redirect(`https://example.com/${encodeURIComponent('secret-invoice-0042.pdf')}`)
    w.open(FILE)
    expect(w.logged).toHaveLength(3)
    for (const line of w.logged) {
      expect(line).not.toMatch(/secret|invoice|Users|example\.com/)
    }
    expect(w.logged[0]).toContain('file:')
  })

  it('wires exactly the two navigation events and the open handler', () => {
    expect(standIn().handlers()).toEqual(['will-navigate', 'will-redirect'])
  })
})

/** The text from `start` to the first `end` after it; throws when either is missing. */
function between(text, start, end) {
  const from = text.indexOf(start)
  const to = from < 0 ? -1 : text.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error(`not found: ${from < 0 ? start : end}`)
  return text.slice(from, to + end.length)
}

describe('D2 — main.cjs\'s calls, by source', () => {
  const createWindow = between(MAIN, 'async function createWindow() {', '\n}\n')
  const prefs = between(createWindow, 'webPreferences: {', '},')

  it('the main window is guarded, with this launch\'s origin read at the moment and the system browser looked up at the call', () => {
    expect(MAIN).toContain("const { guardWindow, isDownloadAddress } = require('./windowGuard.cjs');")
    expect(createWindow).toContain('guardWindow(mainWindow.webContents, windowGuardOptions);')
    expect(createWindow).toContain('origin: () => localServerOrigin,')
    expect(createWindow).toContain('openExternal: (url) => shell.openExternal(url),')
  })

  it('every window the page opens is guarded as a child, and closed when it cannot be', () => {
    const created = between(createWindow, "mainWindow.webContents.on('did-create-window'", '\n  });')
    expect(created).toContain('guardWindow(child.webContents, { ...windowGuardOptions, child: true });')
    expect(created).toContain('child.destroy()')
  })

  it('the old handler that let every non-http window open is gone; no other open handler or navigation listener is set', () => {
    expect(createWindow).not.toContain("return { action: 'allow' };")
    expect(MAIN.match(/setWindowOpenHandler\(/g) || []).toHaveLength(0)
    expect(MAIN).not.toMatch(/on\('will-(navigate|redirect|frame-navigate)'/)
  })

  it('a dropped file never opens in the window\'s place, and the preload runs in the top frame only', () => {
    expect(prefs).toContain('navigateOnDragDrop: false,')
    expect(prefs).toContain('contextIsolation: true,')
    expect(prefs).toContain('nodeIntegration: false,')
    expect(MAIN).not.toContain('nodeIntegrationInSubFrames')
    expect(MAIN).not.toContain('webviewTag: true')
  })
})

// Build review round 1, F1 (HIGH): a cloud download used to send the window
// to its signed address; refused now, it would reach the system browser with
// its token. The page asks the main process instead (`wilson:download-url`).
describe('D2 — the download channel (build review round 1, F1)', () => {
  const PRELOAD = readFileSync(resolve(here, '../../electron/preload.cjs'), 'utf8').replace(/\r\n/g, '\n')
  const FILE_MANAGER = readFileSync(resolve(here, '../tools/rabbit_v0.1.0/components/FileManager.jsx'), 'utf8').replace(/\r\n/g, '\n')
  const FILE_ACTIONS = readFileSync(resolve(here, '../components/Resources/fileActions.js'), 'utf8').replace(/\r\n/g, '\n')

  it('only an http(s) address is downloaded', () => {
    for (const url of ['https://project.supabase.example/storage/v1/object/sign/x?token=t', 'http://gateway.local:8443/x']) expect(isDownloadAddress(url), url).toBe(true)
    for (const url of [FILE, 'data:text/plain,x', 'javascript:alert(1)', `blob:${ORIGIN}/x`, 'ms-settings:privacy', '', 'not a url', null]) expect(isDownloadAddress(url), String(url)).toBe(false)
  })

  it('main answers only this launch\'s page, only for an http(s) address, downloads in the app, and logs nothing', () => {
    const channel = between(MAIN, "ipcMain.handle('wilson:download-url'", '\n});')
    expect(channel).toContain('if (!fromThisLaunchsPage(event) || !isDownloadAddress(url)) return { ok: false };')
    expect(channel).toContain('mainWindow.webContents.downloadURL(new URL(String(url)).href);')
    expect(channel).not.toMatch(/console\.|openExternal|\.loadURL\(/)
    expect(MAIN).toContain("const { guardWindow, isDownloadAddress } = require('./windowGuard.cjs');")
  })

  it('the preload hands the page the channel and nothing more', () => {
    expect(PRELOAD).toContain("downloadUrl: (url) => ipcRenderer.invoke('wilson:download-url', url),")
  })

  it('no page code sends the window to a signed address any more: both cloud downloads go through startSignedDownload', () => {
    const cloud = between(FILE_MANAGER, 'const handleCloudDownload = useCallback(async (file) => {', '}, [ctx])')
    expect(cloud).toContain('await startSignedDownload(signed)')
    expect(cloud).not.toContain('a.href = signed')
    const helper = between(FILE_ACTIONS, 'export async function downloadCloudFile(', '\n}\n')
    expect(helper).toContain('await startSignedDownload(signed, doc)')
    expect(helper).not.toContain('clickLink(doc, signed)')
  })
})

// Build review round 2, F1: the pet's and O.T.T.E.R.'s answers render markdown
// links as plain anchors (no target), and remark-gfm turns an email address
// into a mailto: link. Before D2 a click opened the mail app; refused by the
// guard with nothing in its place it would do nothing. A mailto: address goes
// to the system, as a web address does; no other scheme does.
describe('D2 — an email link still opens the mail app (build review round 2, F1)', () => {
  it('a navigation to mailto: is refused in the window and handed to the system', () => {
    const w = standIn()
    expect(w.navigate('mailto:someone@example.invalid')).toBe('refused')
    expect(w.navigate('tel:+15550100')).toBe('refused')
    expect(w.navigate('ms-settings:privacy')).toBe('refused')
    expect(w.opened).toEqual(['mailto:someone@example.invalid'])
  })

  it('window.open of a mailto: address goes to the system, from the page and from a window it opened', () => {
    expect(openDecision('mailto:someone@example.invalid', ORIGIN)).toEqual({ action: 'deny', external: true })
    expect(openDecision('mailto:someone@example.invalid', ORIGIN, { child: true })).toEqual({ action: 'deny', external: true })
  })

  it('a mailto: address is never the page, and never a download', () => {
    expect(staysOnOwnPage('mailto:someone@example.invalid', ORIGIN)).toBe(false)
    expect(isDownloadAddress('mailto:someone@example.invalid')).toBe(false)
  })
})
