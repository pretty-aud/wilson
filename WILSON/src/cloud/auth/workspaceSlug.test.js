// =============================================================================
// workspaceSlug.test.js — Session 43 §A1.
//
// The login screen's first step turns whatever a person types into the slug
// resolve-login is given. If that normalisation drifts, sign-in fails with the
// generic error and there is nothing on screen to explain why — so the shape
// of this function is load-bearing, not cosmetic.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { SLUG_RE, slugifyWorkspace } from './workspaceSlug'

describe('slugifyWorkspace', () => {
  it('turns a typed company name into the slug the server expects', () => {
    expect(slugifyWorkspace('Smoke Workspace')).toBe('smoke-workspace')
    expect(slugifyWorkspace('Petal Studios')).toBe('petal-studios')
  })

  it('is idempotent — a slug that is already a slug survives untouched', () => {
    expect(slugifyWorkspace('smoke')).toBe('smoke')
    expect(slugifyWorkspace('acme-studios-2')).toBe('acme-studios-2')
  })

  it('strips punctuation and collapses runs rather than rejecting them', () => {
    // Postel's Law: someone typing their company the way they write it must
    // still reach their workspace.
    expect(slugifyWorkspace("O'Brien & Sons, Ltd.")).toBe('o-brien-sons-ltd')
    expect(slugifyWorkspace('  Acme   Studios  ')).toBe('acme-studios')
  })

  it('never emits a leading or trailing dash — SLUG_RE rejects both', () => {
    expect(slugifyWorkspace('-acme-')).toBe('acme')
    expect(slugifyWorkspace('...acme...')).toBe('acme')
    expect(SLUG_RE.test(slugifyWorkspace('-acme-'))).toBe(true)
  })

  it('folds diacritics the way the operator console does', () => {
    // The console derives a new workspace's slug with
    // `.normalize('NFKD').replace(/[^\w\s-]/g, '')`, which folds "Björn" to
    // "bjorn". A bare [^a-z0-9] pass gives "bj-rn", so a company created with
    // every default accepted would be unreachable from the login screen.
    expect(slugifyWorkspace('Björn & Co. Studios')).toBe('bjorn-co-studios')
    expect(slugifyWorkspace('Café Noir')).toBe('cafe-noir')
    expect(slugifyWorkspace('Ünïcodé')).toBe('unicode')
  })

  it('caps at 63 characters', () => {
    const out = slugifyWorkspace('a'.repeat(200))
    expect(out).toHaveLength(63)
    expect(SLUG_RE.test(out)).toBe(true)
  })

  it('returns something SLUG_RE rejects for input that cannot be a slug', () => {
    // The step-1 guard depends on this: empty and single-character results
    // must fail so the user is asked again instead of being sent to step 2
    // with a slug the server will never match.
    for (const bad of ['', '   ', '!!!', 'a', null, undefined]) {
      expect(SLUG_RE.test(slugifyWorkspace(bad))).toBe(false)
    }
  })
})

describe('SLUG_RE', () => {
  it('matches the server-side rule in resolve-login and operator-workspaces', () => {
    // supabase/functions/resolve-login/index.ts isValidSlug — 2 to 63 chars,
    // first character alphanumeric. A client rule that is LOOSER than the
    // server's would send requests that can only ever miss.
    expect(SLUG_RE.test('ab')).toBe(true)
    expect(SLUG_RE.test('a')).toBe(false)
    expect(SLUG_RE.test('-ab')).toBe(false)
    expect(SLUG_RE.test('a'.repeat(63))).toBe(true)
    expect(SLUG_RE.test('a'.repeat(64))).toBe(false)
    expect(SLUG_RE.test('has space')).toBe(false)
    expect(SLUG_RE.test('has_underscore')).toBe(false)
  })
})
