// =============================================================================
// binLocations.test.js — footage locations, the renderer's half (BC2).
//
// What this pins:
//   * Postel's law on the way in: an address pasted from Explorer, a Mac
//     (smb://), with forward slashes, quotes or a trailing backslash becomes
//     the one shape the database stores — and a drive letter, this computer
//     or an administrative share is NOT made acceptable by the rewrite;
//   * the share a picked path lies in (the add flow's "Which location is
//     this? Name it."), and the name a share suggests;
//   * who added a thing, in words (B11), and what this computer said about a
//     location, in words.
// The guard itself (isUncPath) is held to 0091's list beside the desktop's
// and the fixtures' in src/dev/fixtures/binsAdapterParity.test.js.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { isUncPath, normalizeUncInput, shareRootOf, suggestLocationName, addedByName, locationReachWords, notHereSentence, NOT_ON_THIS_COMPUTER } from './binLocations'

describe('normalizeUncInput: what a person pastes, in the stored shape', () => {
  const cases = [
    ['\\\\nas\\footage', '\\\\nas\\footage'],
    ['  \\\\nas\\footage\\  ', '\\\\nas\\footage'],
    ['//nas/footage', '\\\\nas\\footage'],
    ['//nas/footage/day 1/', '\\\\nas\\footage\\day 1'],
    ['smb://nas/footage', '\\\\nas\\footage'],
    ['SMB://nas.corp.local/footage/', '\\\\nas.corp.local\\footage'],
    ['"\\\\nas\\footage"', '\\\\nas\\footage'],
    ['\\\\nas\\\\footage\\\\\\x', '\\\\nas\\footage\\x'],
  ]
  for (const [input, out] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(out)}`, () => {
      expect(normalizeUncInput(input)).toBe(out)
      expect(isUncPath(normalizeUncInput(input))).toBe(true)
    })
  }

  it('never makes a refused address acceptable: a drive letter, this computer, an administrative share stay refused', () => {
    for (const bad of ['C:\\Footage', 'Z:/footage', 'footage', '//localhost/C$', 'smb://127.0.0.1/footage', '\\\\server\\ADMIN$\\', '//nas', '//nas/../x', '\\\\nas\\footage.\\']) {
      expect(isUncPath(normalizeUncInput(bad)), bad).toBe(false)
    }
  })

  it('a drive letter is returned as typed (trimmed), for the check to refuse with the sentence', () => {
    expect(normalizeUncInput('  C:\\Footage ')).toBe('C:\\Footage')
  })
})

describe('the share a path lies in, and a name to start from', () => {
  it('shareRootOf: \\\\server\\share of a path on the network; null off it', () => {
    expect(shareRootOf('\\\\salthours-nas\\footage\\A001\\T1.mov')).toBe('\\\\salthours-nas\\footage')
    expect(shareRootOf('//nas/vfx/plates')).toBe('\\\\nas\\vfx')
    expect(shareRootOf('C:\\Users\\me\\clip.mov')).toBeNull()
    expect(shareRootOf('\\\\localhost\\C$\\Users')).toBeNull()
    expect(shareRootOf('\\\\nas')).toBeNull()
  })

  it('suggestLocationName: the share, in words', () => {
    expect(suggestLocationName('\\\\nas\\footage')).toBe('Footage')
    expect(suggestLocationName('\\\\nas\\vfx_plates')).toBe('Vfx plates')
    expect(suggestLocationName('\\\\nas\\media$')).toBe('Media')
    expect(suggestLocationName('')).toBe('')
  })
})

describe('in words', () => {
  const members = [{ user_id: 'u1', display_name: 'Sofia Aldana' }, { user_id: 'u2', username: 'mara' }]
  it('addedByName: the member, a username, someone who has left, or nothing recorded', () => {
    expect(addedByName('u1', members)).toBe('Sofia Aldana')
    expect(addedByName('u2', members)).toBe('mara')
    expect(addedByName('gone', members)).toBe('someone who has left')
    expect(addedByName(null, members)).toBeNull()
    // The roster's shape too ({ id, name }): what the Bins tab is handed.
    expect(addedByName('u3', [{ id: 'u3', name: 'Mara Okonkwo' }])).toBe('Mara Okonkwo')
  })

  it('notHereSentence (B3): the location named, playback refused, logging kept', () => {
    expect(notHereSentence('Footage NAS')).toBe('"Footage NAS" is not reachable from this computer, so the clip cannot be played here. It can still be logged, flagged and assigned to a shot.')
    expect(notHereSentence(null)).toContain('Its footage location is not reachable')
    expect(NOT_ON_THIS_COMPUTER).toBe('not on this computer')
  })

  it('locationReachWords: what this computer said, or nothing where no desktop answered', () => {
    expect(locationReachWords(null)).toBeNull()
    expect(locationReachWords({ status: 'refused' })).toBeNull()
    expect(locationReachWords({ reachable: true })).toBe('Reachable from this computer')
    expect(locationReachWords({ reachable: false })).toBe('Not reachable from this computer')
    expect(locationReachWords({ reachable: true, local_path: 'Z:\\' })).toBe('On this computer at Z:\\')
    expect(locationReachWords({ reachable: false, local_path: 'Z:\\' })).toBe('Not reachable from this computer (looked in Z:\\)')
  })
})
