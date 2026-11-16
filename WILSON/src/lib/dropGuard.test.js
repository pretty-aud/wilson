/** @vitest-environment jsdom */
// =============================================================================
// dropGuard.test.js — D2 (night 6, 2026-10-29; docs/design/RECONNECT_DESIGN.md
// §13.2; OUTSTANDING D1-01): a file dropped where nothing takes it does
// nothing, and every zone that takes one keeps it.
//
// jsdom's DragEvent has no DataTransfer, so each event is a plain Event with
// a stand-in `dataTransfer` (its `types`, its `files`, a settable
// `dropEffect`), dispatched cancelable and bubbling from a real element: the
// order of the window's, the document's and the element's listeners is the
// DOM's own. The desktop run with a trusted drop is §13.7's.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDropGuard, guardsThisDrag, carriesFiles } from './dropGuard'

const here = dirname(fileURLToPath(import.meta.url))

const cleanups = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()()
  document.body.innerHTML = ''
})

/** Listen and remember to stop listening after the test. */
function listen(target, type, fn) {
  target.addEventListener(type, fn)
  cleanups.push(() => target.removeEventListener(type, fn))
}

function dragEvent(type, { types = ['Files'], files = [{ name: 'made-up.pdf' }] } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'dataTransfer', { value: { types, files, dropEffect: 'copy' } })
  return e
}

function guard() {
  cleanups.push(installDropGuard(window))
}

describe('D2 — a file dropped where nothing takes it', () => {
  it('dragover and drop nothing handled are cancelled, with the no-drop cursor', () => {
    guard()
    const spot = document.body.appendChild(document.createElement('div'))
    const over = dragEvent('dragover')
    spot.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('none')
    const drop = dragEvent('drop')
    spot.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
  })

  it('CONTROL: without the guard the same drop is left to the browser (which opens the file)', () => {
    const spot = document.body.appendChild(document.createElement('div'))
    const drop = dragEvent('drop')
    spot.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
  })

  it('the detach function takes the guard away', () => {
    const off = installDropGuard(window)
    off()
    const drop = dragEvent('drop')
    document.body.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
  })
})

describe('D2 — every zone that takes a file keeps it', () => {
  it('a zone\'s own handler (React-style, on the element) sees the drop first, with its files, and keeps its dropEffect', () => {
    guard()
    const zone = document.body.appendChild(document.createElement('div'))
    const seen = []
    listen(zone, 'dragover', (e) => { seen.push(['over', e.defaultPrevented]); e.preventDefault(); e.dataTransfer.dropEffect = 'link' })
    listen(zone, 'drop', (e) => { seen.push(['drop', e.defaultPrevented, e.dataTransfer.files.length]); e.preventDefault() })
    const over = dragEvent('dragover')
    zone.dispatchEvent(over)
    expect(over.dataTransfer.dropEffect).toBe('link')
    zone.dispatchEvent(dragEvent('drop'))
    expect(seen).toEqual([['over', false], ['drop', false, 1]])
  })

  it('Bins\' drop-anywhere at the document, registered AFTER the guard, still finds the drop unhandled and takes it', () => {
    guard()                                    // first, as main.jsx installs it before the first render
    const taken = []
    // BinsView.jsx's own listeners, in their shape: `defaultPrevented` read as
    // "a zone took it", the cursor set only when nothing has.
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
    listen(document, 'dragover', (e) => { if (!hasFiles(e)) return; if (!e.defaultPrevented) e.dataTransfer.dropEffect = 'link'; e.preventDefault() })
    listen(document, 'drop', (e) => { if (!hasFiles(e)) return; const handled = e.defaultPrevented; e.preventDefault(); if (!handled) taken.push(e.dataTransfer.files.length) })
    const spot = document.body.appendChild(document.createElement('div'))
    const over = dragEvent('dragover')
    spot.dispatchEvent(over)
    expect(over.dataTransfer.dropEffect).toBe('link')
    spot.dispatchEvent(dragEvent('drop'))
    expect(taken).toEqual([1])
  })

  it('CONTROL: the same guard on the document, registered first, would have taken Bins\' drop from it', () => {
    cleanups.push(installDropGuard(document))
    const taken = []
    listen(document, 'drop', (e) => { const handled = e.defaultPrevented; e.preventDefault(); if (!handled) taken.push(1) })
    document.body.dispatchEvent(dragEvent('drop'))
    expect(taken).toEqual([])
  })

  it('a zone that accepts the drag but forgets to cancel its drop still gets it, and the page is kept', () => {
    guard()
    const zone = document.body.appendChild(document.createElement('div'))
    const got = []
    listen(zone, 'drop', (e) => got.push(e.dataTransfer.files.length))
    const drop = dragEvent('drop')
    zone.dispatchEvent(drop)
    expect(got).toEqual([1])
    expect(drop.defaultPrevented).toBe(true)
  })
})

describe('D2 — what the guard leaves alone (review round, F1)', () => {
  it('a text drag over a text field reaches the window uncancelled: the browser\'s own text drop stays', () => {
    guard()
    const field = document.body.appendChild(document.createElement('textarea'))
    const over = dragEvent('dragover', { types: ['text/plain'], files: [] })
    field.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(false)
    expect(over.dataTransfer.dropEffect).toBe('copy')
    const drop = dragEvent('drop', { types: ['text/plain'], files: [] })
    field.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
  })

  it('the app\'s own drag-and-drop (a custom type, a link) is not the guard\'s', () => {
    guard()
    for (const types of [['application/x-wilson-task'], ['text/uri-list', 'text/plain'], []]) {
      const over = dragEvent('dragover', { types, files: [] })
      document.body.dispatchEvent(over)
      expect(over.defaultPrevented, types.join(',')).toBe(false)
    }
  })

  it('a missing or hostile dataTransfer never throws', () => {
    expect(carriesFiles({})).toBe(false)
    expect(carriesFiles({ dataTransfer: { get types() { throw new Error('nope') } } })).toBe(false)
    expect(guardsThisDrag(null)).toBe(false)
    expect(guardsThisDrag({ defaultPrevented: true, dataTransfer: { types: ['Files'] } })).toBe(false)
    expect(installDropGuard(null)()).toBeUndefined()
  })
})

describe('D2 — installed once, by the app\'s entry, before the first render', () => {
  it('main.jsx installs it on the window at load, outside any component', () => {
    const main = readFileSync(resolve(here, '../main.jsx'), 'utf8').replace(/\r\n/g, '\n')
    expect(main).toContain("import { installDropGuard } from './lib/dropGuard'")
    const at = main.indexOf('installDropGuard(window)')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(main.indexOf('function render()'))
    expect(main.match(/installDropGuard\(/g)).toHaveLength(1)
  })
})
