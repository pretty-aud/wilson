// =============================================================================
// pathContainment.test.js — Session 33.
//
// The containment guard (electron/pathContainment.cjs, extracted from
// main.cjs) is the security boundary between a client-supplied storage_path /
// relink mapping and fs.unlinkSync (S14, TPN-NET-013). This suite pins BOTH
// directions of it:
//
//   1. The escape cases stay null. These were measured working on 2026-08-05
//      BEFORE the S33 fix — they are here so the fix can never trade
//      fail-closed for fail-open. Trimming separators from both sides, or a
//      plain startsWith without the separator boundary, fails these.
//
//   2. The root-base cases resolve. path.resolve() returns a bare root WITH
//      a trailing separator ('C:\', and any two-component UNC path — which is
//      exactly how a person names a share, '\\FILESERVER\Projects'), so the
//      old comparison built a doubled separator no real path matches and
//      refused every file under such a root: download 400'd, delete orphaned
//      the body, relink refused folders genuinely inside the root.
//
// CI runs on ubuntu-latest, so Windows semantics are exercised via the
// injectable pathImpl (makeContainment(path.win32)) rather than the platform
// default — these assertions are identical on every runner.
//
// ⚠️ A unit test over the helper alone would have passed on 2026-08-05 while
// downloads 400'd — the helper WAS the defect, but only its call sites made
// it visible. The wiring block at the bottom scans electron/main.cjs the way
// validatorSave.test.js does, pinning that the download/delete routes still
// reach this module's function and that no local redefinition has crept back.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { makeContainment } = require('../../../electron/pathContainment.cjs')

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const win = makeContainment(path.win32)
const posix = makeContainment(path.posix)

describe('resolveContainedFilePath — escape cases stay null (fail closed)', () => {
  const DEEP_UNC = '\\\\fileserver\\Projects\\Hero_FILES'

  it('.. traversal out of a UNC base is refused', () => {
    expect(win.resolveContainedFilePath(DEEP_UNC, '..\\..\\..\\..\\..\\secret.txt')).toBeNull()
  })
  it('an absolute foreign share is refused', () => {
    expect(win.resolveContainedFilePath(DEEP_UNC, '\\\\attacker\\share\\x')).toBeNull()
  })
  it('a forward-slash foreign share is refused', () => {
    expect(win.resolveContainedFilePath(DEEP_UNC, '//attacker/share/x')).toBeNull()
  })
  it('an absolute local path is refused against a UNC base', () => {
    expect(win.resolveContainedFilePath(DEEP_UNC, 'C:\\Windows\\win.ini')).toBeNull()
  })
  it('.. traversal out of a plain base is refused', () => {
    expect(win.resolveContainedFilePath('C:\\Users\\A\\proj_FILES', '..\\evil')).toBeNull()
  })
  it('a sibling with the base as a name prefix is refused (separator boundary)', () => {
    expect(win.resolveContainedFilePath('C:\\foo', '..\\foobar\\x')).toBeNull()
  })
  it('a drive-relative path on another drive is refused', () => {
    expect(win.resolveContainedFilePath('C:\\Users\\A\\proj_FILES', 'D:evil.txt')).toBeNull()
  })
  it('posix: .. traversal is refused', () => {
    expect(posix.resolveContainedFilePath('/srv/media', '../etc/passwd')).toBeNull()
  })
})

describe('resolveContainedFilePath — root bases resolve (the S33 fix)', () => {
  it('a two-component UNC share root contains its children', () => {
    expect(win.resolveContainedFilePath('\\\\srv\\share', 'a.mov'))
      .toBe(path.win32.resolve('\\\\srv\\share', 'a.mov'))
  })
  it('a drive root contains its children', () => {
    expect(win.resolveContainedFilePath('C:\\', 'a.mov')).toBe('C:\\a.mov')
  })
  it('a mapped-drive-shaped root contains nested children', () => {
    expect(win.resolveContainedFilePath('Z:\\', 'sub\\a.mov')).toBe('Z:\\sub\\a.mov')
  })
  it('escapes from a root base still clamp or refuse', () => {
    // path.resolve clamps .. at the root — the result stays inside.
    expect(win.resolveContainedFilePath('C:\\', '..\\..\\x')).toBe('C:\\x')
    // A different drive is still refused.
    expect(win.resolveContainedFilePath('C:\\', 'D:\\x')).toBeNull()
    // A foreign share is still refused against a share root.
    expect(win.resolveContainedFilePath('\\\\srv\\share', '\\\\attacker\\share\\x')).toBeNull()
  })
  it('posix: the filesystem root contains its children', () => {
    expect(posix.resolveContainedFilePath('/', 'a.mov')).toBe('/a.mov')
  })
})

describe('resolveContainedFilePath — pre-S33 behaviour preserved for normal bases', () => {
  it('a contained file resolves', () => {
    expect(win.resolveContainedFilePath('C:\\Users\\A\\proj_FILES', 'a.mov'))
      .toBe('C:\\Users\\A\\proj_FILES\\a.mov')
  })
  it('a deep UNC base resolves its children (measured fine before the fix)', () => {
    expect(win.resolveContainedFilePath('\\\\srv\\share\\Projects', 'a.mov'))
      .toBe(path.win32.resolve('\\\\srv\\share\\Projects', 'a.mov'))
  })
  it('an empty relPath resolves to the base itself', () => {
    expect(win.resolveContainedFilePath('C:\\Users\\A\\proj_FILES', ''))
      .toBe('C:\\Users\\A\\proj_FILES')
  })
  it('comparison is case-folded (NTFS/APFS), result keeps original casing', () => {
    expect(win.resolveContainedFilePath('c:\\FOO', 'BAR')).toBe('c:\\FOO\\BAR')
  })
})

describe('isPathInside — the relink-root comparison', () => {
  it('a folder inside a share root is inside (the S33 relink fix)', () => {
    expect(win.isPathInside('\\\\srv\\share', '\\\\srv\\share\\Projects\\X')).toBe(true)
  })
  it('a sibling share is not inside', () => {
    expect(win.isPathInside('\\\\srv\\share', '\\\\srv\\share2')).toBe(false)
  })
  it('a drive root contains everything on the drive', () => {
    expect(win.isPathInside('C:\\', 'C:\\anything\\below')).toBe(true)
  })
  it('identity counts as inside', () => {
    expect(win.isPathInside('C:\\Users\\A', 'C:\\Users\\A')).toBe(true)
  })
  it('a name-prefix sibling is not inside (separator boundary)', () => {
    expect(win.isPathInside('C:\\Users\\A', 'C:\\Users\\AB')).toBe(false)
  })
  it('another drive is not inside a drive root', () => {
    expect(win.isPathInside('C:\\', 'D:\\x')).toBe(false)
  })
})

// ── Wiring: the routes still reach THIS function ─────────────────────────────
// The helper being correct proves nothing if main.cjs stops calling it
// (the S31 lesson: a green unit test over a dead path). Source-scan in the
// validatorSave.test.js shape.

describe('wiring — electron/main.cjs uses the extracted guard', () => {
  const MAIN = read('../../../electron/main.cjs')

  it('requires pathContainment.cjs', () => {
    expect(MAIN).toMatch(/require\('\.\/pathContainment\.cjs'\)/)
  })
  it('does not redefine resolveContainedFilePath locally (any declaration form)', () => {
    // function/const/let/var forms — a const-arrow re-inlining would dodge
    // a function-only scan (review finding, S33). The require's destructure
    // ('const { resolveContainedFilePath') does not match: the token after
    // const is a brace.
    expect(MAIN).not.toMatch(/(?:function|const|let|var)\s+resolveContainedFilePath\s*[=(]/)
  })
  it('does not redefine isPathInside locally (any declaration form)', () => {
    expect(MAIN).not.toMatch(/(?:function|const|let|var)\s+isPathInside\s*[=(]/)
  })
  it('the download route containment-checks and logs a downloaded event', () => {
    const route = MAIN.slice(MAIN.indexOf("files/:id/download'"))
    // Slice to the next route registration — '});' alone matches the first
    // inline res.json(...) and truncates the body.
    const body = route.slice(0, route.indexOf('expressApp.'))
    expect(body).toContain('resolveContainedFilePath(')
    expect(body).toContain("event:            'downloaded'")
    expect(body).toContain('writeRabbitBundle(')
  })
  it('the delete route containment-checks before unlink', () => {
    const idx = MAIN.indexOf("expressApp.delete('/api/rabbit/projects/:projectId/files/:id'")
    expect(idx).toBeGreaterThan(-1)
    const body = MAIN.slice(idx, MAIN.indexOf('unlinkSync', idx) + 20)
    expect(body).toContain('resolveContainedFilePath(')
  })
  it('isUserAuthorizedRelinkDir compares via isPathInside', () => {
    const idx = MAIN.indexOf('function isUserAuthorizedRelinkDir')
    expect(idx).toBeGreaterThan(-1)
    const body = MAIN.slice(idx, idx + 1200)
    expect(body).toContain('isPathInside(')
  })
})

describe('wiring — the cloud adapter logs downloads', () => {
  const ADAPTER = read('./adapters/supabaseAdapter.js')

  it('downloadFile calls the log_file_downloaded RPC and checks .error', () => {
    const idx = ADAPTER.indexOf('async downloadFile(')
    expect(idx).toBeGreaterThan(-1)
    const body = ADAPTER.slice(idx, ADAPTER.indexOf('},', ADAPTER.indexOf("rpc('log_file_downloaded'", idx)))
    expect(body).toContain("rpc('log_file_downloaded', { p_file_id: file.id })")
    expect(body).toContain('logged.error')
  })
  it('the audit drawer can render the new event', () => {
    const DRAWER = read('./components/FileAuditDrawer.jsx')
    expect(DRAWER).toMatch(/downloaded:\s*\{ label: 'Downloaded'/)
  })
})
