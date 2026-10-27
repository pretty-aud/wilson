// =============================================================================
// gatewayWalkthrough.test.js — GW3 (2026-10-11): walkthrough 62 and its README
// row held to the code's own words, as GW2's docs.test.mjs holds 61.
//
// A walkthrough that quotes a sentence the tab no longer says sends Audrey
// looking for words that are not there; so every sentence 62 puts in
// italics is the module's, built the way the tab builds it, and the files
// it names (the launch entry, the scripts, the pictures) exist by those
// names. N1 (2026-10-27) deleted the one-off script that took its pictures,
// `bins-gateway-shots.mjs`: the walkthrough is history and keeps the name,
// so that one file is no longer held to existing.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  CATALOGUE_GATEWAY_SENTENCE, GATEWAY_ADMIN_LINE, CHROME_LOCAL_NETWORK_SENTENCE, NEEDS_DESKTOP_FORMAT, GATEWAY_OWN_COMPUTER_LINE,
  PLAYER_LARGE_HINT, POSTER_LARGE_HINT, gatewayUnseenSentence, gatewayUnreachableSentence, gatewayClipSentence, gatewayMissingSentence,
  FULLSCREEN_KEEPS_MARK, PLAYER_KEEPS_KEYS,
} from './binLocations'
import { GATEWAY_REFRESH_MS } from '../adapters/gatewayBins'
import { RENEW_AFTER_MS } from './gatewayDoors'
import { MARK_POSITIONS, MARK_MOVE_MS } from '../views/bins/GatewayVideo'

const root = process.cwd()
const read = (p) => readFileSync(path.join(root, p), 'utf8')
const walk = read('docs/walkthroughs/62_file_gateway_playback.md')
const index = read('docs/walkthroughs/README.md')
// The walkthrough sets the tab's sentences in italics, with the bold the
// notice itself carries removed; compare on the words alone.
// The walkthrough wraps its lines: compare on the words, whitespace collapsed.
const plain = (s) => s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\s+/g, ' ')
const has = (sentence) => plain(walk).includes(plain(sentence))

describe('walkthrough 62 quotes the tab\'s own sentences', () => {
  it('the notice with a gateway, the admin\'s line, Chrome\'s prompt, the own-computer line, the format sentence, the two hints', () => {
    for (const s of [CATALOGUE_GATEWAY_SENTENCE, GATEWAY_ADMIN_LINE, CHROME_LOCAL_NETWORK_SENTENCE, GATEWAY_OWN_COMPUTER_LINE, NEEDS_DESKTOP_FORMAT, PLAYER_LARGE_HINT, POSTER_LARGE_HINT, FULLSCREEN_KEEPS_MARK, PLAYER_KEEPS_KEYS]) {
      expect(has(s), s).toBe(true)
    }
  })
  it('§2\'s rows as the test data says them: the silent gateway, the unreachable one, no gateway, not mounted, a clip not at its path', () => {
    expect(has(gatewayUnseenSentence('Salt Hours NAS', 240))).toBe(true)
    expect(has(gatewayUnreachableSentence('Salt Hours NAS', '192.168.10.20:8443'))).toBe(true)
    expect(has(gatewayClipSentence('Footage NAS', 'no_gateway'))).toBe(true)
    expect(has(gatewayClipSentence('Archive', 'not_mounted'))).toBe(true)
    expect(has(gatewayMissingSentence('Footage NAS'))).toBe(true)
  })
  it('the numbers it states are the code\'s: 60 s re-read, 75 s renewal, five positions every thirty seconds', () => {
    expect(GATEWAY_REFRESH_MS).toBe(60_000)
    expect(walk).toMatch(/every 60 s|60-second/)
    expect(RENEW_AFTER_MS).toBe(75_000)
    expect(walk).toContain('renewal at 75 s')
    expect(MARK_POSITIONS).toHaveLength(5)
    expect(MARK_MOVE_MS).toBe(30_000)
    expect(walk).toContain('every thirty seconds')
  })
  it('names things that exist: the launch entry, the two scripts, the fifteen pictures, migration 0095 and suite 98', () => {
    expect(walk).toContain('gw3-worktree')
    expect(walk).toContain('port 5289')
    for (const f of ['scripts/gateway-playback-e2e.mjs', 'scripts/gateway-fullscreen-guard.mjs', 'supabase/tests/rls/98_gateway_next_root_viewing_fraction.sql']) {
      expect(existsSync(path.join(root, f)), f).toBe(true)
      expect(walk, f).toContain(path.basename(f))
    }
    expect(existsSync(path.join(root, 'supabase/migrations/0095_gateway_next_root_viewing_fraction.sql'))).toBe(true)
    expect(walk).toContain('migration **0095**')
    expect(walk).toContain('suite **98**')
    const shots = [...walk.matchAll(/po-gw3-(\d\d)-/g)].map((m) => Number(m[1]))
    expect(Math.min(...shots)).toBe(1)
    expect(Math.max(...shots)).toBe(15)
    for (const state of ['bins-gateway-notice', 'bins-inspector-player-inside', 'bins-player-large-space', 'bins-inspector-needs-desktop-format', 'bins-inspector-player-outside-mark', 'bins-notice-no-gateway-admin-line', 'bins-notice-gateway-unseen', 'bins-notice-gateway-unreachable', 'bins-inspector-clip-missing-404', 'bins-clip-viewings-table', 'settings-gateway-next-root']) {
      expect(walk, state).toContain(state)
    }
  })
  it('the README row links the file and says what it is', () => {
    expect(index).toMatch(/\| 62 \| \[62_file_gateway_playback\.md\]\(62_file_gateway_playback\.md\) \| GW3: /)
  })
})
