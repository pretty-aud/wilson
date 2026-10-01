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
const { resolveOpenTarget, refuseToOpen, OPEN_REFUSED_EXT, OPEN_ALLOWED_EXT } = require(resolve(here, '../../../../electron/openPath.cjs'))
const PROGRAMS = 'WILSON does not open programs or scripts. Use Show in folder to see it.'
const OFF_THE_LIST = 'WILSON opens documents, pictures, video, audio and 3D files in their own app. Use Show in folder for this one.'
const real = (p) => fs.realpathSync(p)
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
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'f1' }, deps())).toEqual({ ok: true, diskPath: projectFile, realPath: real(projectFile) })
    expect(resolveOpenTarget({ source: 'managed', projectId: 'p1', fileId: 'm1' }, deps())).toEqual({ ok: true, diskPath: managedFile, realPath: real(managedFile) })
  })

  it('a row the locator does not know, or another project\'s, is "not on this computer"', () => {
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'nope' }, deps())).toEqual({ ok: false, error: 'This file is not on this computer.' })
    expect(resolveOpenTarget({ source: 'files', projectId: 'p2', fileId: 'f1' }, deps()).ok).toBe(false)
  })

  it('a directory is not a file', () => {
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'dir' }, deps())).toEqual({ ok: false, error: 'That is not a file.' })
  })

  it('a private project\'s media key resolves under the media root', () => {
    expect(resolveOpenTarget({ source: 'media', mediaKey: KEY }, deps())).toEqual({ ok: true, diskPath: join(media, ...KEY.split('/')), realPath: real(join(media, ...KEY.split('/'))) })
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
  it('refuses the executable and script extensions, in any case, in their own words', () => {
    for (const p of ['C:\\a\\setup.exe', 'x/run.BAT', 'y/tool.cmd', 'z/thing.js', 'w/x.vbs', 'v/link.lnk', 'u/a.ps1', 'q/i.msi', 'r/a.hta', 's/x.JSE']) {
      expect(refuseToOpen(p), p).toBe(PROGRAMS)
    }
  })
  it('DENY BY DEFAULT (round 1, R1-SEC-01): the launch types a refusal list missed, and anything unknown, are refused', () => {
    for (const p of ['a/report.settingcontent-ms', 'b/fix.diagcab', 'c/help.chm', 'd/x.msc', 'e/lib.library-ms', 'f/app.jnlp', 'g/x.website', 'h/x.wsc', 'i/x.sct']) {
      expect(refuseToOpen(p), p).toBe(PROGRAMS)
    }
    // Not a known launcher, and not on the list: still refused.
    for (const p of ['j/pkg.appx', 'k/thing.xyz', 'l/README', 'm/evil.exe.', 'n/evil.exe ', 'o/page.html', 'p/vector.svg', 'q/scene.ma', 'r/comp.nk', 's/a.docm']) {
      expect(refuseToOpen(p), JSON.stringify(p)).toBe(OFF_THE_LIST)
    }
  })
  it('CONTROL: production files open (documents, pictures, video, audio, 3D)', () => {
    for (const p of ['a/brief.pdf', 'b/take.MOV', 'c/notes.md', 'd/board.png', 'e/budget.xlsx', 'f/script.fdx', 'g/vo.wav',
      'h/plate.exr', 'i/hero.fbx', 'j/set.usdz', 'k/subs.srt', 'l/cut.edl', 'm/raw.dng', 'n/a.mxf']) {
      expect(refuseToOpen(p), p).toBeNull()
    }
  })
  it('the two lists never overlap (a refused type can never be let in by the other)', () => {
    expect([...OPEN_ALLOWED_EXT].filter((e) => OPEN_REFUSED_EXT.has(e))).toEqual([])
    expect(OPEN_ALLOWED_EXT.size).toBeGreaterThan(60)
  })
})

describe('a link is judged by where it LEADS (round 1, R1-SEC-01)', () => {
  it('a row whose path is brief.pdf but really leads to an .exe resolves to the .exe, which is refused', () => {
    const exe = join(outside, 'calc.exe')
    const linked = deps({ fs: { ...fs, realpathSync: (p) => (p === projectFile ? exe : fs.realpathSync(p)) } })
    const t = resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'f1' }, linked)
    expect(t).toEqual({ ok: true, diskPath: projectFile, realPath: exe })
    expect(refuseToOpen(t.realPath)).toBe(PROGRAMS)
    // CONTROL: the same row with no link leads to itself and opens.
    const plain = resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'f1' }, deps())
    expect(refuseToOpen(plain.realPath)).toBeNull()
  })

  it('a real file symlink, where this machine lets a test make one', () => {
    const exe = join(outside, 'tool.exe')
    writeFileSync(exe, 'MZ')
    const link = join(base, 'files', 'linked-brief.pdf')
    try { symlinkSync(exe, link, 'file') } catch { return } // no symlink privilege here: the injected case above stands
    const t = resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'lnk' },
      deps({ locateRow: (p, f) => (p === 'p1' && f === 'lnk' ? link : null) }))
    expect(t.ok).toBe(true)
    expect(t.realPath.toLowerCase().endsWith('tool.exe')).toBe(true)
    expect(refuseToOpen(t.realPath)).toBe(PROGRAMS)
  })

  it('a path that cannot be resolved to a real one is "not on this computer"', () => {
    const broken = deps({ fs: { ...fs, realpathSync: () => { throw new Error('EACCES') } } })
    expect(resolveOpenTarget({ source: 'files', projectId: 'p1', fileId: 'f1' }, broken)).toEqual({ ok: false, error: 'This file is not on this computer.' })
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
    // The real target is judged, AND it is what opens (round 1, R1-SEC-01).
    expect(body).toContain('const refusal = refuseToOpen(target.realPath) || refuseToOpen(target.diskPath);')
    expect(body).toContain('await shell.openPath(target.realPath)')
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
