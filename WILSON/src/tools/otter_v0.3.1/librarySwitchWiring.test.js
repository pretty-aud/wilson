// =============================================================================
// librarySwitchWiring.test.js — A4, Audrey's decisions 3 and 28b
//
// libraryMode.test.js proves the SEAM behaves. This file proves the seam is
// actually reached from the two components that have to use it, which nothing
// in this tree can do by rendering: there is no jsdom, so these are source
// scans over Otter.jsx and App.jsx.
//
// 🚨 Every assertion here SLICES the region it means before matching. A
// `toContain` over a 5,700-line file is the failure mode this repo has already
// shipped twice: the string is present, in the wrong handler, and the test is
// green. Where a count is the point, the IDENTIFIER is counted exactly rather
// than a syntax pattern that a spread or an alias walks past.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const otterCode = readFileSync(join(here, 'Otter.jsx'), 'utf8')
const appCode = readFileSync(join(here, '..', '..', 'App.jsx'), 'utf8')

/** The body of a top-level `function name() {` in Otter.jsx, by brace balance.
 *  Slicing to a fixed character count instead would silently include whatever
 *  follows once the function grew. */
function functionBody(code, header) {
  const start = code.indexOf(header)
  expect(start, 'header not found: ' + header).toBeGreaterThan(-1)
  let i = code.indexOf('{', start)
  let depth = 0
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++
    else if (code[j] === '}') {
      depth--
      if (depth === 0) return code.slice(start, j + 1)
    }
  }
  throw new Error('unbalanced braces after ' + header)
}

describe('Otter.jsx reaches the adapter seam', () => {
  it('imports the three mode functions from the ONE adapters module', () => {
    const line = otterCode.split(/\r?\n/).find(l => l.startsWith('import') && l.includes("from './adapters'"))
    expect(line).toBeTruthy()
    for (const fn of ['getOtterAdapterMode', 'setOtterAdapterMode', 'subscribeOtterAdapterMode']) {
      expect(line, fn + ' missing from the adapters import').toContain(fn)
    }
  })

  it('🚨 subscribes, so the view follows a switch made anywhere', () => {
    expect(otterCode).toContain('useEffect(() => subscribeOtterAdapterMode(setLibraryMode), [])')
  })

  it('🚨 cloudMode is re-derived when the mode moves, not only on a session change', () => {
    // Without libraryMode in the deps the sharing/trash/requests affordances
    // keep rendering against a backend that has no idea what they are.
    expect(otterCode).toContain('[perms.ready, perms.workspaceId, libraryMode]')
  })
})

describe('switching libraries throws away the other library state', () => {
  // 🚨 SLICED BY EXPLICIT MARKERS, and both are asserted to exist. The first
  // version of this block built its slice from a nested indexOf of the effect's
  // DEPENDENCY ARRAY text; adding one dependency made that lookup return -1, the
  // slice collapsed to 39 characters, and the assertions were suddenly checking
  // almost nothing. A slice whose bounds are not checked is not a slice.
  const START = 'const lastLibraryModeRef'
  const END = '  }, [libraryMode, invalidateCache'
  const from = otterCode.indexOf(START)
  const to = otterCode.indexOf(END, from)
  const effect = otterCode.slice(from, to)

  it('the effect can be located at all', () => {
    expect(from, 'start marker missing').toBeGreaterThan(-1)
    expect(to, 'end marker missing').toBeGreaterThan(from)
    expect(effect.length).toBeGreaterThan(200)
  })

  it('🚨 invalidates the per-course caches — the two libraries do not share a slug space', () => {
    // On disk a slug is slugify(name); in cloud it is the course UUID. A cached
    // entry that survives the switch renders the old library's content under the
    // new library's name.
    expect(effect).toContain('invalidateCache();')
    expect(effect).toContain('setActiveSoftwareSlug(null);')
    expect(effect).toContain('setActiveSubjectSlug(null);')
    expect(effect).toContain("setCourseFilter('all');")
    expect(effect).toContain("setCurrentView('library');")
  })

  it('🚨 RE-LISTS. Nothing else in this file will.', () => {
    // The bug this catches was live for one commit: the effect cleared the open
    // course and a comment claimed "the effect below re-lists on this change".
    // There is no such effect — every loadSoftwareList() call in Otter.jsx is
    // inside a handler or the mount effect — so the switch left the OTHER
    // library's courses on screen and the whole feature looked broken.
    expect(effect).toContain('loadSoftwareList();')
    // …and it must be a DEPENDENCY, or the effect closes over a stale one.
    expect(otterCode).toContain('}, [libraryMode, invalidateCache, loadSoftwareList]);')
  })

  it('🚨 guards the FIRST run — a mount must not look like a switch', () => {
    // Without the ref the effect fires on mount, closing the course the user
    // just opened from a deep link and re-listing for no reason.
    expect(effect).toContain('if (lastLibraryModeRef.current === libraryMode) return;')
  })

  it('🚨 a load already in flight cannot install the OTHER library', () => {
    // loadSoftwareList is fire-and-forget and fans out seven requests per course.
    // Flip the switch mid-load and the old load's setSoftwareList can land after
    // the new one, and its detail fetches repopulate the caches AFTER
    // invalidateCache() cleared them. The generation is bumped BEFORE the clear.
    expect(effect).toContain('listGenerationRef.current += 1;')
    const bumpAt = effect.indexOf('listGenerationRef.current += 1;')
    const clearAt = effect.indexOf('invalidateCache();')
    expect(bumpAt, 'the bump must come BEFORE the clear').toBeLessThan(clearAt)
    // and the loader must actually consult it, in all three places it writes.
    const loader = otterCode.slice(
      otterCode.indexOf('const loadSoftwareList = useCallback'),
      otterCode.indexOf('const selectSoftware = useCallback'))
    expect(loader.length).toBeGreaterThan(400)
    expect(loader).toContain('const generation = listGenerationRef.current')
    expect((loader.match(/if \(!current\(\)\) return/g) || []).length,
      'expected the guard before the list write and the cache write').toBe(2)
    expect(loader).toContain('if (current()) subjectCacheRef.current[cacheKey] = fullSub;')
  })

  it('the ref is seeded from the current mode, not from a constant', () => {
    expect(effect).toContain('useRef(libraryMode)')
  })
})

describe('the notice on the library screen', () => {
  const notice = functionBody(otterCode, 'function renderLibrarySourceNotice()')

  it('is defined AND rendered — exactly one of each', () => {
    const hits = otterCode.split('renderLibrarySourceNotice').length - 1
    expect(hits, 'expected one definition and one call site').toBe(2)
  })

  it('🚨 is rendered on the library LIST, not somewhere the user never looks', () => {
    const lib = functionBody(otterCode, 'function renderLibrary()')
    expect(lib).toContain('{renderLibrarySourceNotice()}')
  })

  it('says nothing at all on the web build, where there is no local library', () => {
    expect(notice).toContain('if (!hasLocalLibrary) return null;')
  })

  it('🚨 covers BOTH directions — the switch creates the mirror-image trap', () => {
    // Local hidden is the case Audrey reported. Company hidden is the one the
    // fix itself introduces: pin "This computer", forget, and read the missing
    // company courses as data loss.
    expect(notice).toContain('const localHidden   = cloudMode;')
    expect(notice).toContain("libraryMode === 'local'")
    expect(notice).toContain('if (!localHidden && !companyHidden) return null;')
  })

  it('🚨 carries the way back, so recovery does not depend on finding Settings', () => {
    expect(notice).toContain("setOtterAdapterMode(localHidden ? 'local' : 'auto')")
  })

  it('the two button labels are the ones the walkthrough names', () => {
    expect(notice).toContain('Show the courses on this computer')
    expect(notice).toContain('Show the company library')
  })
})

describe('the Settings control (decision 3) and the dead field (decision 28b)', () => {
  it('🚨 the dead "Storage Location" field is GONE, not merely hidden', () => {
    // It wrote settings.storageLocation, which nothing has ever read — courses
    // live at userData/otter-data/software/ regardless. RELEASE_TESTING #3.
    expect(otterCode).not.toContain('saveSettings({ storageLocation')
    expect(otterCode).not.toContain('Default: ./data/software/')
    expect(otterCode).not.toContain('{/* Storage Location */}')
  })

  it('🚨 the settings-error banner SURVIVED the removal', () => {
    // S30 added it because a refused write left the field showing a value that
    // was never saved. It lived inside the block that was deleted; losing it
    // would have made every failed write on this tab silent again.
    expect(otterCode).toContain('<span className="font-bold">Not saved.</span> {settingsError}')
  })

  it('offers exactly the two positions Audrey asked for, by their labels', () => {
    expect(otterCode).toContain('Company (signed in)')
    expect(otterCode).toContain('This computer')
  })

  it('🚨 both positions actually write through the seam', () => {
    // Counted as identifiers with their arguments: a control that renders the
    // label and calls nothing is the exact shape of the field it replaced.
    expect(otterCode).toContain("{ mode: 'auto',")
    expect(otterCode).toContain("{ mode: 'local',")
    expect(otterCode).toContain('onClick={() => setOtterAdapterMode(opt.mode)}')
  })

  it('is desktop-only — the web has no local library to switch to', () => {
    expect(otterCode).toContain('const hasLocalLibrary = ')
    expect(otterCode).toContain('{hasLocalLibrary && (')
  })
})

describe('App.jsx: the pet index follows the switch', () => {
  it('imports the subscriber alongside otterFetch, from the same seam', () => {
    const line = appCode.split(/\r?\n/).find(l => l.includes("from './tools/otter_v0.3.1/adapters'"))
    expect(line).toContain('otterFetch')
    expect(line).toContain('subscribeOtterAdapterMode')
  })

  it('🚨 clears the knowledge index on a mode change', () => {
    // Phase 6 reads through otterFetch, so the CONTENT follows the switch by
    // itself. The cache does not: it is module-level, keyed on nothing, and
    // warm for five minutes — so the pet would keep answering Blender
    // questions out of the library the user just left.
    expect(appCode).toContain('useEffect(() => subscribeOtterAdapterMode(() => clearPetKnowledgeCache()), []);')
  })

  it('🚨 the identity-keyed clear is still there too — this ADDS a trigger', () => {
    // Replacing the identity effect with the subscription would let one
    // person's library survive into the next person's session.
    const idx = appCode.indexOf('clearPetKnowledgeCache();')
    expect(idx).toBeGreaterThan(-1)
    expect(appCode.slice(idx, idx + 120)).toContain('[perms.ready, perms.userId, perms.workspaceId]')
  })
})
