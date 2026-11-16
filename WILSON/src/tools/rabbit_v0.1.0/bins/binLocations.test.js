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
import {
  isUncPath, normalizeUncInput, suggestLocationName, addedByName, locationReachWords, notHereSentence, NOT_ON_THIS_COMPUTER,
  CATALOGUE_SENTENCE, CATALOGUE_GATEWAY_SENTENCE, GATEWAY_ADMIN_LINE, CHROME_LOCAL_NETWORK_SENTENCE, NEEDS_DESKTOP_FORMAT, GATEWAY_LOADING,
  GATEWAY_OWN_COMPUTER_LINE, PLAYER_LARGE_HINT, POSTER_LARGE_HINT, gatewayUnseenSentence, gatewayUnreachableSentence, GATEWAY_REACH_WORDS,
  gatewayReachWord, gatewayClipSentence, gatewayMissingSentence, browserClipSentence,
} from './binLocations'

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

// Review round 1: the renderer's shareRootOf had no caller (the desktop's
// prepare answers each outside path's share_root, from shareRootOfPath in
// electron/rabbitBins.cjs, whose own tests keep the shape); it went, and its
// test with it.
describe('a name to start from', () => {
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

// ── GW3: the file gateway, in the Bins tab's words (GATEWAY_DESIGN.md §2, §5, §7) ──
describe('GW3: the gateway\'s words', () => {
  it('the catalogue sentence with a gateway says clips play here and adding still needs the desktop; the admin\'s line names Settings, Storage', () => {
    expect(CATALOGUE_GATEWAY_SENTENCE).toContain('Clips play here through the company\'s file gateway')
    expect(CATALOGUE_GATEWAY_SENTENCE).toContain('adding clips still needs the desktop app')
    expect(CATALOGUE_GATEWAY_SENTENCE.split('. ')[0]).toBe(CATALOGUE_SENTENCE.split('. ')[0])
    expect(GATEWAY_ADMIN_LINE).toBe('A file gateway lets browsers play clips from the company\'s server: Settings, Storage.')
    expect(CHROME_LOCAL_NETWORK_SENTENCE).toBe('Chrome will ask whether WILSON may reach devices on your network; allow it once.')
    expect(PLAYER_LARGE_HINT).toBe('Space plays the clip large.')
    expect(POSTER_LARGE_HINT).toBe('Space shows the picture large.')
    expect(GATEWAY_LOADING).toBe('loading') // D22: nothing more while the first play's round trip runs
    expect(NEEDS_DESKTOP_FORMAT).toBe('This clip\'s format does not play in a browser; the desktop app plays it.')
    expect(GATEWAY_OWN_COMPUTER_LINE).toContain('does not answer its own host')
  })

  it('§2\'s second and third rows: the gateway named, the silence in minutes, the certificate named', () => {
    expect(gatewayUnseenSentence('Studio NAS', 240)).toBe('The company\'s gateway "Studio NAS" has not answered WILSON for 4 minutes, so clips cannot play here. Everything else works; someone on the office network can check it.')
    expect(gatewayUnseenSentence('Studio NAS', 45)).toContain('for 45 seconds')
    expect(gatewayUnseenSentence('Studio NAS', 60)).toContain('for 60 seconds') // under 90 s the count is in seconds
    expect(gatewayUnseenSentence('Studio NAS', 100)).toContain('for 2 minutes')
    expect(gatewayUnseenSentence('Studio NAS', 3 * 3600)).toContain('for 3 hours')
    expect(gatewayUnseenSentence(null, 120)).toBe('The company\'s gateway has not answered WILSON for 2 minutes, so clips cannot play here. Everything else works; someone on the office network can check it.')
    expect(gatewayUnreachableSentence('Studio NAS', '192.168.1.10:8443')).toBe('WILSON can see the gateway "Studio NAS" but this browser cannot reach it at 192.168.1.10:8443. On the office network, the gateway\'s certificate must be installed on this computer (Settings, Storage). From outside, the switch is off or the outside door is not open.')
    expect(gatewayUnreachableSentence(null, null)).toBe('WILSON can see the gateway but this browser cannot reach it. On the office network, the gateway\'s certificate must be installed on this computer (Settings, Storage). From outside, the switch is off or the outside door is not open.')
  })

  it('§2\'s fourth row: the four reach words are the gateway\'s own, in the design\'s shape', () => {
    expect(GATEWAY_REACH_WORDS).toEqual({
      not_reachable: 'not reachable through the gateway',
      not_mounted: 'not mounted on the gateway',
      not_connected: 'not connected on the gateway: run share-login on the gateway',
      unknown_address: 'this gateway cannot use this address',
    })
    expect(Object.isFrozen(GATEWAY_REACH_WORDS)).toBe(true)
    expect(gatewayReachWord('not_reachable', 'Archive')).toBe('not reachable through the gateway (Archive)')
    expect(gatewayReachWord('unknown_address', null)).toBe('this gateway cannot use this address')
    expect(gatewayReachWord('nonsense', 'A')).toBe('not reachable through the gateway (A)')
  })

  it('the sentence under a clip: one per state, each naming the location where there is one and keeping the logging tail', () => {
    const tail = 'It can still be logged, flagged and assigned to a shot.'
    const states = ['no_gateway', 'gateway_unreachable', 'unseen', 'not_mounted', 'not_connected', 'unknown_address', 'not_reachable']
    const sentences = states.map((s) => gatewayClipSentence('Footage NAS', s))
    expect(new Set(sentences).size).toBe(states.length)
    for (const s of sentences) expect(s.endsWith(tail)).toBe(true)
    expect(gatewayClipSentence('Footage NAS', 'not_mounted')).toBe(`"Footage NAS" is not mounted on the gateway, so the clip cannot be played here. ${tail}`)
    expect(gatewayClipSentence('Footage NAS', 'not_connected')).toContain('run share-login on the gateway')
    expect(gatewayClipSentence('Footage NAS', 'unknown_address')).toBe(`The gateway cannot use the address of "Footage NAS", so the clip cannot be played here. ${tail}`)
    expect(gatewayClipSentence('Footage NAS', 'no_gateway')).toContain('No file gateway is enrolled')
    expect(gatewayClipSentence('Footage NAS', 'gateway_unreachable')).toContain('This browser cannot reach the company\'s file gateway')
    expect(gatewayClipSentence('Footage NAS', 'unseen')).toContain('has not answered WILSON')
    expect(gatewayClipSentence(null, 'not_reachable')).toBe(`Its footage location is not reachable through the gateway, so the clip cannot be played here. ${tail}`)
    expect(gatewayMissingSentence('Footage NAS')).toBe(`The clip is not at its path on "Footage NAS": the gateway looked and found nothing there. ${tail}`)
    expect(gatewayMissingSentence(null)).toContain('on its footage location:')
    // The plain browser sentence (no gateway enrolled, the fixtures' catalogue) is unchanged.
    expect(browserClipSentence('Footage NAS')).toContain('A browser cannot read "Footage NAS"')
  })
})
