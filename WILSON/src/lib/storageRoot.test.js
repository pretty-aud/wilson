// =============================================================================
// storageRoot.test.js — Session 34.
//
// classifyRoot/canonicalizeRoot are the string half of the storage-root save
// pipeline (StorageSection). The shapes pinned here are the measured ones
// from NETWORK_STORAGE_DESIGN.md §3.2/§3.3: the trailing separator that made
// the pre-S33 guard refuse every file, the bare share/drive roots that hand
// WILSON an entire disk, and the four spellings of one folder that make a
// mapped drive letter unshippable. Mapped-vs-local for a drive letter is NOT
// decidable from the string — the classifier reports the letter so the
// caller must consult the Electron probe (net use); that division of labour
// is asserted here too.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { canonicalizeRoot, classifyRoot } from './storageRoot'

const R = String.raw

describe('canonicalizeRoot', () => {
  it('trims surrounding whitespace', () => {
    expect(canonicalizeRoot('  \\\\nas\\projects\\wilson  ')).toBe(R`\\nas\projects\wilson`)
  })
  it('unifies forward slashes, preserving the UNC lead-in', () => {
    expect(canonicalizeRoot('//nas/projects/wilson')).toBe(R`\\nas\projects\wilson`)
    expect(canonicalizeRoot('C:/Users/Audrey/My_Work')).toBe(R`C:\Users\Audrey\My_Work`)
  })
  it('collapses doubled internal separators', () => {
    expect(canonicalizeRoot(R`\\nas\\projects\\\wilson`)).toBe(R`\\nas\projects\wilson`)
  })
  it('strips trailing separators — the §3.2 shape that broke every file op', () => {
    // Plain literals here: a raw template cannot END in a single backslash
    // (it would escape its own closing backtick).
    expect(canonicalizeRoot('\\\\nas\\projects\\wilson\\')).toBe(R`\\nas\projects\wilson`)
    expect(canonicalizeRoot('C:\\Projects\\\\')).toBe(R`C:\Projects`)
  })
  it('keeps the bare drive root separator — C: alone is drive-relative', () => {
    expect(canonicalizeRoot('C:\\')).toBe('C:\\')
  })
  it('returns the empty string for empty or non-string input', () => {
    expect(canonicalizeRoot('')).toBe('')
    expect(canonicalizeRoot('   ')).toBe('')
    expect(canonicalizeRoot(null)).toBe('')
    expect(canonicalizeRoot(undefined)).toBe('')
  })
})

describe('classifyRoot — UNC', () => {
  it('a share subfolder is the good shape', () => {
    const c = classifyRoot(R`\\nas\projects\wilson`)
    expect(c.kind).toBe('unc')
    expect(c.bareRoot).toBe(false)
    expect(c.reason).toBeNull()
  })
  it('a bare \\\\server\\share is refused with a subfolder suggestion', () => {
    const c = classifyRoot(R`\\nas\projects`)
    expect(c.kind).toBe('unc')
    expect(c.bareRoot).toBe(true)
    expect(c.reason).toMatch(/whole share/i)
  })
  it('host case does not change the classification (§3.3: case folds)', () => {
    expect(classifyRoot(R`\\FILESERVER\Projects`).bareRoot).toBe(true)
    expect(classifyRoot(R`\\fileserver\projects`).bareRoot).toBe(true)
  })
  it('a lone \\\\server is invalid', () => {
    expect(classifyRoot(R`\\nas`).kind).toBe('invalid')
  })
})

describe('classifyRoot — drive letters', () => {
  it('a local folder classifies local and carries its letter', () => {
    const c = classifyRoot(R`C:\Users\Audrey\Documents\My_Work`)
    expect(c.kind).toBe('local')
    expect(c.bareRoot).toBe(false)
    expect(c.driveLetter).toBe('C')
    expect(c.reason).toBeNull()
  })
  it('a bare drive root is refused — containment under C:\\ contains the drive', () => {
    const c = classifyRoot('C:\\')
    expect(c.kind).toBe('local')
    expect(c.bareRoot).toBe(true)
    expect(c.reason).toMatch(/whole C: drive/i)
  })
  it('Z:\\Projects classifies local — mapped detection is the PROBE\u2019s job, so the letter is reported for the caller to check', () => {
    const c = classifyRoot(R`Z:\Projects`)
    expect(c.kind).toBe('local')
    expect(c.driveLetter).toBe('Z')
  })
})

describe('classifyRoot — invalid shapes', () => {
  it.each([
    ['drive-relative', R`C:foo\bar`],
    ['relative', R`foo\bar`],
    ['empty', ''],
  ])('%s input is invalid', (_label, input) => {
    const c = classifyRoot(input)
    expect(c.kind).toBe('invalid')
    expect(c.reason).toBeTruthy()
  })

  it('dot segments are refused — \\\\srv\\share\\x\\.. would defeat the bare-root refusal after resolution', () => {
    expect(classifyRoot(R`\\srv\share\x\..`).kind).toBe('invalid')
    expect(classifyRoot(R`C:\Projects\.\media`).kind).toBe('invalid')
  })
  it('device-namespace prefixes are refused', () => {
    expect(classifyRoot(R`\\?\C:\Projects`).kind).toBe('invalid')
    expect(classifyRoot(R`\\.\PhysicalDrive0`).kind).toBe('invalid')
  })
})
