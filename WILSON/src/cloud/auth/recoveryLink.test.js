// =============================================================================
// recoveryLink.test.js — Session 18.
//
// The invite / recovery landing path had NO automated coverage (MASTER_PLAN
// §6 #68), and it was carrying a defect that made every invite link fail even
// when it was live. These cases exist so that cannot recur silently.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { parseRecoveryLink, looksLikeRecoveryLink } from './recoveryLink'

// The exact fragment GoTrue v2.194.0 redirects to after GET /verify. It echoes
// the requested type back — `q.Set("type", params.Type)` in verify.go — so an
// invite says `type=invite` and a reset says `type=recovery`.
const legacyFragment = (type) =>
  `#/recovery#access_token=AAA&expires_in=3600&refresh_token=BBB&token_type=bearer&type=${type}`

describe('parseRecoveryLink — shape 1: token_hash (S18 templates)', () => {
  it('parses an invite carried in the hash-router query', () => {
    expect(parseRecoveryLink('#/recovery?token_hash=abc123&type=invite', ''))
      .toEqual({ kind: 'verify', token_hash: 'abc123', type: 'invite' })
  })

  it('parses a recovery carried in the hash-router query', () => {
    expect(parseRecoveryLink('#/recovery?token_hash=abc123&type=recovery', ''))
      .toEqual({ kind: 'verify', token_hash: 'abc123', type: 'recovery' })
  })

  it('parses a token_hash carried in the real query string', () => {
    // Shape depends on where the configured Site URL puts its own path, which
    // we cannot read from the client — so both are accepted.
    expect(parseRecoveryLink('#/recovery', '?token_hash=abc123&type=invite'))
      .toEqual({ kind: 'verify', token_hash: 'abc123', type: 'invite' })
  })

  it('terminates the hash-router query at a later "#"', () => {
    // Not a shape GoTrue can emit — a URL has one fragment. It is here because
    // without the guard the trailing text glues itself onto `type`, and the
    // link then fails the type check for a reason nobody could read.
    const r = parseRecoveryLink(
      '#/recovery?token_hash=abc123&type=invite#access_token=AAA&refresh_token=BBB&type=recovery',
      '',
    )
    expect(r).toEqual({ kind: 'verify', token_hash: 'abc123', type: 'invite' })
  })

  it('rejects a token_hash with a type WILSON never mints', () => {
    // 'magiclink' is a valid GoTrue type but nothing here issues one; treat it
    // as malformed rather than pass it to verifyOtp.
    expect(parseRecoveryLink('#/recovery?token_hash=abc123&type=magiclink', '')).toBeNull()
  })

  it('rejects a token_hash with no type at all', () => {
    expect(parseRecoveryLink('#/recovery?token_hash=abc123', '')).toBeNull()
  })
})

describe('parseRecoveryLink — shape 2: implicit grant (links already in flight)', () => {
  it('parses a recovery fragment behind the hash-router prefix', () => {
    expect(parseRecoveryLink(legacyFragment('recovery'), '')).toEqual({
      kind: 'session', access_token: 'AAA', refresh_token: 'BBB', type: 'recovery',
    })
  })

  it('parses a recovery fragment with no hash-router prefix', () => {
    expect(parseRecoveryLink('#access_token=AAA&refresh_token=BBB&type=recovery', '')).toEqual({
      kind: 'session', access_token: 'AAA', refresh_token: 'BBB', type: 'recovery',
    })
  })

  // ---------------------------------------------------------------------------
  // THE REGRESSION. Before S18 this returned null and the invitee was told the
  // link had already been used — on a link that was live and untouched.
  // ---------------------------------------------------------------------------
  it('parses an INVITE fragment (S18 fix — this used to be rejected)', () => {
    expect(parseRecoveryLink(legacyFragment('invite'), '')).toEqual({
      kind: 'session', access_token: 'AAA', refresh_token: 'BBB', type: 'invite',
    })
  })

  it('pins the OLD predicate, so the defect cannot quietly return', () => {
    // Verbatim from ResetPasswordWizard.jsx:42 before S18.
    const oldPredicateAccepts = (raw) => {
      const tail = raw.includes('#') ? raw.slice(raw.lastIndexOf('#') + 1) : raw
      if (!tail.includes('access_token=')) return false
      return new URLSearchParams(tail).get('type') === 'recovery'
    }
    // What it did: recovery yes, invite no. That asymmetry WAS the bug.
    expect(oldPredicateAccepts(legacyFragment('recovery'))).toBe(true)
    expect(oldPredicateAccepts(legacyFragment('invite'))).toBe(false)
    // What we do now: both.
    expect(parseRecoveryLink(legacyFragment('invite'))).not.toBeNull()
  })

  it('rejects a fragment missing the refresh token', () => {
    expect(parseRecoveryLink('#access_token=AAA&type=recovery', '')).toBeNull()
  })

  it('rejects a fragment with an unusable type', () => {
    expect(parseRecoveryLink(legacyFragment('magiclink'), '')).toBeNull()
  })
})

describe('parseRecoveryLink — non-links', () => {
  it.each([
    ['empty hash', ''],
    ['ordinary route', '#/dashboard'],
    ['the recovery route with nothing on it', '#/recovery'],
    ['a GoTrue error redirect', '#/recovery#error=access_denied&error_code=otp_expired'],
    ['undefined', undefined],
  ])('returns null for %s', (_label, hash) => {
    expect(parseRecoveryLink(hash, '')).toBeNull()
  })
})

describe('looksLikeRecoveryLink — routing into the wizard', () => {
  it.each([
    ['#/recovery?token_hash=abc&type=invite', ''],
    ['#/recovery', ''],
    [legacyFragment('invite'), ''],
    [legacyFragment('recovery'), ''],
    ['#access_token=AAA&refresh_token=BBB&type=recovery', ''],
    ['', '?token_hash=abc&type=recovery'],
    // Spent or malformed links must still route IN, so the user gets the
    // explanation rather than a login screen that ignores their click.
    ['#/recovery#error=access_denied&error_code=otp_expired', ''],
  ])('routes %s into the wizard', (hash, search) => {
    expect(looksLikeRecoveryLink(hash, search)).toBe(true)
  })

  it.each([
    ['', ''],
    ['#/dashboard', ''],
    ['#/otter', '?tab=courses'],
  ])('leaves %s on the login screen', (hash, search) => {
    expect(looksLikeRecoveryLink(hash, search)).toBe(false)
  })
})
