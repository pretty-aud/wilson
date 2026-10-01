// =============================================================================
// openPath.test.js — post-overhaul S4a: what rabbit:open-path may touch
// (electron/openPath.cjs), on a real temp folder.
//
// "Open in default app" hands a file to the operating system, so the rules are
// security rules: the renderer names a ROW and never a path; a private
// project's media key must be one WILSON wrote and must stay inside the media
// root — by real path too, so a junction cannot lead out; the target must be
// an existing regular file; a program or a script is never OPENED (its
// default app runs it) though it may be revealed. Every refusal below has a
// presence control beside it, and the main.cjs wiring is read as source.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { resolveOpenTarget, refuseToOpen, OPEN_REFUSED_EXT } = require(resolve(here, '../../../../electron/openPath.cjs'))
const { checkMediaKey, insideByRealPath } = require(resolve(here, '../../../../electron/localMedia.cjs'))
const { resolveContainedFilePath } = require(resolve(here, '../../../../electron/pathContainment.cjs'))
const mainCjs = readFileSync(resolve(here, '../../../../electron/main.cjs'), 'utf8')
const preload = readFileSync(resolve(here, '../../../../electron/preload.cjs'), 'utf8')

let base, media, outside, projectFile, managedFile
const KEY = 'projects/aaaa1111-0000-0000-0000-000000000001/project/p/1-brief.pdf'

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 's4a-openpath-'))
  media = join(base, 'media')
  outside = join(base, 'outside')
  mkdirSync(join(media, 'projects', 'aaaa1111-0000-0000-0000-000000000001', 'project', 'p'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(media, ...KEY.split('/')), 'pdf')
  writeFileSync(join(outside, 'secret.txt'), 'nope')
  projectFile = join(base, 'files', 'brief.pdf')
  managedFile = join(base, 'files', 'take.mov')
  mkdirSync(join(base, 'files'), { recursive: true })
  writeFileSync(projectFile, 'pdf')
  writeFileSync(managedFile, 'mov')
  // A junction INSIDE the media root that leads out of it.
  try { symlinkSync(outside, join(media, 'projects', 'aaaa1111-0000-0000-0000-000000000001', 'project', 'jx'), 'junction') } catch { /* platform without junctions: the probe below says so */ }
})
afterAll(() => { rmSync(base, { recursive: true, force: true }) })

const deps = (over = {}) => ({
  fs,
  locateRow: (projectId, fileId, source) => {
    if (projectId !== 'p1') return null
    if (source === 'files' && fileId === 'f1') return projectFile
    if (source === 'managed' && fileId === 'm1') return managedFile
    if (source === 'files' && fileId === 'dir') return join(base, 'files')
    return null
  },
  mediaRoot: () => media,
  checkMediaKey,
  resolveContainedFilePath,
  insideByRealPath,
  ...over,
})

describe('rabbit:open-path resolves a ROW to a file on this disk', () => {
  it('a Local Server file and a managed file resolve through the locator', () => {
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'f1' }, deps())).toEqual({ ok: true, diskPath: projectFile })
    expect(resolveOpenTarget({ source: 'managed', projectId: 'p1', fileId: 'm1' }, deps())).toEqual({ ok: true, diskPath: managedFile })
  })

  it('a row the locator does not know, or another project\'s, is "not on this computer"', () => {
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'nope' }, deps())).toEqual({ ok: false, error: 'This file is not on this computer.' })
    expect(resolveOpenTarget({ source: 'files', projectId: 'p2', fileId: 'f1' }, deps()).ok).toBe(false)
  })

  it('a directory is not a file', () => {
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'dir' }, deps())).toEqual({ ok: false, error: 'That is not a file.' })
  })

  it('a private project\'s media key resolves under the media root', () => {
    expect(resolveOpenTarget({ source: 'media', mediaKey: KEY }, deps())).toEqual({ ok: true, diskPath: join(media, ...KEY.split('/')) })
  })

  it('a key WILSON did not write is refused: traversal, a drive letter, a bare path', () => {
    for (const mediaKey of ['projects/../outside/secret.txt', 'C:/Windows/notepad.exe', '../outside/secret.txt', 'outside/secret.txt', '']) {
      const r = resolveOpenTarget({ source: 'media', mediaKey }, deps())
      expect(r.ok, mediaKey).toBe(false)
    }
  })

  it('a junction inside the media root that leads OUT is refused by the real-path check', () => {
    const viaJunction = 'projects/aaaa1111-0000-0000-0000-000000000001/project/jx/secret.txt'
    const lexical = resolveContainedFilePath(media, viaJunction.split('/').join('\\'))
    if (!lexical || !fs.existsSync(lexical)) return // no junction support here: nothing to prove
    expect(resolveOpenTarget({ source: 'media', mediaKey: viaJunction }, deps()).ok).toBe(false)
    // CONTROL: without the real-path check the same key would have resolved.
    const naive = resolveOpenTarget({ source: 'media', mediaKey: viaJunction }, deps({ insideByRealPath: () => true }))
    expect(naive.ok).toBe(true)
  })

  it('an unknown source, or no local server, refuses', () => {
    expect(resolveOpenTarget({ source: 'path', fileId: 'C:\\Windows\\notepad.exe' }, deps()).ok).toBe(false)
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'f1' }, deps({ locateRow: null })))
      .toEqual({ ok: false, error: 'The local server is not running.' })
  })
})

describe('a program or a script is never OPENED (its default app runs it)', () => {
  it('refuses the executable and script extensions, in any case', () => {
    for (const p of ['C:\\a\\setup.exe', 'x/run.BAT', 'y/tool.cmd', 'z/thing.js', 'w/x.vbs', 'v/link.lnk', 'u/a.ps1', 'q/i.msi', 'r/a.hta', 's/x.JSE']) {
      expect(refuseToOpen(p), p).toBe('WILSON does not open programs or scripts. Use Show in folder to see it.')
    }
  })
  it('CONTROL: production files open', () => {
    for (const p of ['a/brief.pdf', 'b/take.mov', 'c/notes.md', 'd/board.png', 'e/budget.xlsx', 'f/script.fdx']) {
      expect(refuseToOpen(p), p).toBeNull()
    }
    expect(OPEN_REFUSED_EXT.has('.pdf')).toBe(false)
  })
})

describe('the wiring: main resolves, the page names a row', () => {
  it('the IPC goes through openPath.cjs with main\'s locator and the media root, reveals before it refuses', () => {
    const at = mainCjs.indexOf("ipcMain.handle('rabbit:open-path'")
    expect(at).toBeGreaterThan(-1)
    const body = mainCjs.slice(at, mainCjs.indexOf('\n});', at))
    expect(body).toContain("require('./openPath.cjs')")
    expect(body).toContain('locateRow: rabbitFileLocator')
    expect(body).toContain('mediaRoot: () => getLocalMediaRoot({ create: false })')
    expect(body).not.toMatch(/filePath/)
    expect(body.indexOf('shell.showItemInFolder')).toBeLessThan(body.indexOf('refuseToOpen('))
    expect(body.indexOf('refuseToOpen(')).toBeLessThan(body.indexOf('shell.openPath'))
  })

  it('the locator lives in the server closure and uses the download route\'s resolvers', () => {
    const at = mainCjs.indexOf('rabbitFileLocator = (projectId, fileId, source) =>')
    expect(at).toBeGreaterThan(mainCjs.indexOf('function startLocalServer('))
    const body = mainCjs.slice(at, mainCjs.indexOf('};', at))
    expect(body).toContain('resolveManagedFileDiskPath(bundle, mf)')
    expect(body).toContain('resolveContainedFilePath(resolveFileBaseDir(bundle, projectId, file), file.storage_path)')
    expect(body).toContain('!f.deleted_at')
  })

  it('the preload exposes it as rabbit.openPath', () => {
    expect(preload).toContain("openPath:             (opts) => ipcRenderer.invoke('rabbit:open-path', opts),")
  })
})
