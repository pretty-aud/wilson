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
const { resolveOpenTarget, refuseToOpen, OPEN_REFUSED_EXT, OPEN_ALLOWED_EXT, openOrReveal, makeRowLocator } = require(resolve(here, '../../../../electron/openPath.cjs'))
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

  it('a junction inside the media root that leads OUT is refused by the real-path check', (ctx) => {
    const viaJunction = 'projects/aaaa1111-0000-0000-0000-000000000001/project/jx/secret.txt'
    const lexical = resolveContainedFilePath(media, viaJunction.split('/').join('\\'))
    // Windows makes a junction without any privilege, so there it MUST exist
    // (round 1, R1-TST-15: a bare `return` passed silently); elsewhere the
    // test says it was skipped.
    if (process.platform === 'win32') expect(lexical && fs.existsSync(lexical), 'the junction was not made').toBeTruthy()
    else if (!lexical || !fs.existsSync(lexical)) { ctx.skip(); return }
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
    // .xml / .fcpxml (round 2, R2-SEC-03): Windows hands XML to the browser,
    // which runs script in XHTML- or SVG-namespaced XML from file://.
    for (const p of ['j/pkg.appx', 'k/thing.xyz', 'l/README', 'm/evil.exe.', 'n/evil.exe ', 'o/page.html', 'p/vector.svg', 'q/scene.ma', 'r/comp.nk', 's/a.docm', 't/cut-list.xml', 'u/edit.fcpxml']) {
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

  it('a real file symlink, where this machine lets a test make one', (ctx) => {
    const exe = join(outside, 'tool.exe')
    writeFileSync(exe, 'MZ')
    const link = join(base, 'files', 'linked-brief.pdf')
    // A file symlink needs a privilege Windows may not grant: then this test
    // reports itself SKIPPED, and the injected case above stands.
    try { symlinkSync(exe, link, 'file') } catch { ctx.skip(); return }
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

describe('openOrReveal: the whole IPC, with a fake shell (round 1, R1-TST-02)', () => {
  const fakeShell = () => {
    const calls = []
    return {
      calls,
      showItemInFolder: (p) => { calls.push(['reveal', p]) },
      openPath: async (p) => { calls.push(['open', p]); return '' },
    }
  }
  const exeRow = () => {
    const exe = join(base, 'files', 'setup.exe')
    writeFileSync(exe, 'MZ')
    return deps({ locateRow: (p, f) => (p === 'p1' && f === 'x1' ? exe : null) })
  }

  it('a program is never handed to the shell to open; its refusal is the answer', async () => {
    const shell = fakeShell()
    expect(await openOrReveal({ source: 'files', projectId: 'p1', fileId: 'x1' }, { ...exeRow(), shell })).toEqual({ ok: false, error: PROGRAMS })
    expect(shell.calls).toEqual([])
  })

  it('a link named brief.pdf that leads to an .exe is refused, and nothing opens', async () => {
    const shell = fakeShell()
    const exe = join(outside, 'calc.exe')
    const linked = deps({ fs: { ...fs, realpathSync: (p) => (p === projectFile ? exe : fs.realpathSync(p)) } })
    expect((await openOrReveal({ source: 'files', projectId: 'p1', fileId: 'f1' }, { ...linked, shell })).ok).toBe(false)
    expect(shell.calls).toEqual([])
  })

  it('Show in folder reveals the named path and NEVER opens it — not even a program', async () => {
    const shell = fakeShell()
    expect(await openOrReveal({ source: 'files', projectId: 'p1', fileId: 'x1', reveal: true }, { ...exeRow(), shell })).toEqual({ ok: true })
    expect(shell.calls).toEqual([['reveal', join(base, 'files', 'setup.exe')]])
  })

  it('CONTROL: a PDF opens, once, by its real path', async () => {
    const shell = fakeShell()
    expect(await openOrReveal({ source: 'files', projectId: 'p1', fileId: 'f1' }, { ...deps(), shell })).toEqual({ ok: true })
    expect(shell.calls).toEqual([['open', real(projectFile)]])
  })

  it('the shell\'s own failure is the answer', async () => {
    const shell = { ...fakeShell(), openPath: async () => 'No application is associated with the specified file' }
    expect(await openOrReveal({ source: 'files', projectId: 'p1', fileId: 'f1' }, { ...deps(), shell }))
      .toEqual({ ok: false, error: 'No application is associated with the specified file' })
  })

  it('a row that does not resolve touches nothing', async () => {
    const shell = fakeShell()
    expect((await openOrReveal({ source: 'files', projectId: 'p1', fileId: 'nope', reveal: true }, { ...deps(), shell })).ok).toBe(false)
    expect(shell.calls).toEqual([])
  })
})

describe('makeRowLocator: one row of the bundle, through main\'s resolvers', () => {
  const bundle = {
    files: [
      { id: 'f1', name: 'brief.pdf', storage_path: '1-brief.pdf' },
      { id: 'f2', name: 'other.pdf', storage_path: '2-other.pdf' },
    ],
    managedFiles: [
      { id: 'm1', stored_name: 'take.mov' },
      { id: 'm2', stored_name: 'gone.mov', deleted_at: '2026-09-30T10:00:00Z' },
    ],
  }
  const locate = makeRowLocator({
    readRabbitBundle: (pid) => (pid === 'p1' ? bundle : null),
    resolveManagedFileDiskPath: (_b, mf) => `M:\\managed\\${mf.stored_name}`,
    resolveContainedFilePath: (dir, rel) => `${dir}\\${rel}`,
    resolveFileBaseDir: () => 'F:\\project',
  })
  it('a files row resolves to ITS path, not another row\'s', () => {
    expect(locate('p1', 'f1', 'files')).toBe('F:\\project\\1-brief.pdf')
    expect(locate('p1', 'f2', 'files')).toBe('F:\\project\\2-other.pdf')
  })
  it('a managed file resolves; a soft-deleted one resolves to nothing', () => {
    expect(locate('p1', 'm1', 'managed')).toBe('M:\\managed\\take.mov')
    expect(locate('p1', 'm2', 'managed')).toBeNull()
  })
  it('an unknown row, an unknown project, or a managed id asked as a file: nothing', () => {
    expect(locate('p1', 'nope', 'files')).toBeNull()
    expect(locate('p2', 'f1', 'files')).toBeNull()
    expect(locate('p1', 'm1', 'files')).toBeNull()
  })
})

describe('the wiring: main resolves, the page names a row', () => {
  it('the IPC is openOrReveal with main\'s shell, locator and media root — nothing decided in main', () => {
    const at = mainCjs.indexOf("ipcMain.handle('rabbit:open-path'")
    expect(at).toBeGreaterThan(-1)
    const body = mainCjs.slice(at, mainCjs.indexOf('\n});', at))
    expect(body).toContain("const { openOrReveal } = require('./openPath.cjs');")
    expect(body).toContain('return openOrReveal(req, {')
    expect(body).toMatch(/\n\s+shell,\r?\n/)
    expect(body).toContain('locateRow: rabbitFileLocator')
    expect(body).toContain('mediaRoot: () => getLocalMediaRoot({ create: false })')
    expect(body).not.toMatch(/filePath|shell\.openPath|shell\.showItemInFolder|refuseToOpen/)
  })

  it('the locator is makeRowLocator over the download route\'s resolvers, in the server closure', () => {
    const at = mainCjs.indexOf("rabbitFileLocator = require('./openPath.cjs').makeRowLocator({")
    expect(at).toBeGreaterThan(mainCjs.indexOf('function startLocalServer('))
    expect(mainCjs.slice(at, mainCjs.indexOf('});', at))).toContain('readRabbitBundle, resolveManagedFileDiskPath, resolveContainedFilePath, resolveFileBaseDir,')
  })

  it('the preload exposes it as rabbit.openPath', () => {
    expect(preload).toContain("openPath:             (opts) => ipcRenderer.invoke('rabbit:open-path', opts),")
  })
})
