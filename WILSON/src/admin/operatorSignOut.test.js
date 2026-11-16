// =============================================================================
// operatorSignOut.test.js — the operator console's sign-out has the shape
// App.jsx's signOutLocal has (Track B merge, review round 1, B-R1-10).
//
// The track's R2 commit (e5dd486) said both sign-out paths were reordered —
// clearSession() first, then the revoke under a 4 s ceiling, one flight at a
// time — and only App.jsx's was. On the console a hung revoke on idle or cap
// expiry left the operator's session on disk and the console signed in, on
// the most privileged surface there is, and no test looked. This one reads
// OperatorApp.jsx as text and pins the ORDER, the ceiling and the guard, with
// a control that shows the b5a8646 shape fails it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'OperatorApp.jsx'), 'utf8')

/** The handleSignOut callback's body, from its declaration to its deps. */
function signOutBlock(text) {
  const start = text.indexOf('const handleSignOut = useCallback(')
  const end = text.indexOf('}, [])', start)
  if (start === -1 || end === -1) throw new Error('handleSignOut not found')
  return text.slice(start, end)
}

/**
 * true when the block has the App.jsx shape: the single-flight guard first,
 * clearSession() before the row, the row before the revoke, the revoke
 * bounded, the state teardown last, and no unbounded revoke anywhere.
 * Throws naming the first missing piece.
 */
function hardened(block) {
  const at = (s) => {
    const i = block.indexOf(s)
    if (i === -1) throw new Error(`missing: ${s}`)
    return i
  }
  const guard = at('if (signingOutRef.current) return signingOutRef.current')
  const clear = at('await clearSession()')
  const row = at('await recordAuthEvent(event)')
  const revoke = at("withTimeout(supabase.auth.signOut({ scope: 'local' }), AUTH_EVENT_TIMEOUT_MS")
  const done = at('setSession(null)')
  const unbounded = block.includes('await supabase.auth.signOut(')
  return guard < clear && clear < row && row < revoke && revoke < done && !unbounded
}

describe('OperatorApp sign-out (B-R1-10)', () => {
  it('clears the session first, writes the row second, revokes under the 4 s ceiling third, one flight at a time', () => {
    expect(hardened(signOutBlock(src))).toBe(true)
  })

  it('the flight is released by the next sign-in, not by the sign-out itself', () => {
    const signedIn = src.slice(src.indexOf('const handleSignedIn = useCallback('), src.indexOf('const handleSignOut = useCallback('))
    expect(signedIn).toContain('signingOutRef.current = null')
    expect(signOutBlock(src)).not.toContain('signingOutRef.current = null')
  })

  it('keeps the corner card for the cap notice — this surface has no ToastProvider (B-R1-03)', () => {
    expect(src).toMatch(/<SessionWarning[\s\S]*?placement="corner"/)
    // No provider MOUNTED (the tag, not the word — a comment names it).
    expect(src).not.toContain('<ToastProvider')
    expect(src).not.toMatch(/import\s*\{[^}]*\bToastProvider\b/)
  })

  it('the control: the b5a8646 shape fails — the revoke unbounded, clearSession after it, no guard', () => {
    const track = [
      'const handleSignOut = useCallback(async (opts) => {',
      "    const event = opts && (typeof opts.event === 'string' || opts.event === null) ? opts.event : 'sign_out'",
      '    if (event) await recordAuthEvent(event)',
      "    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* best effort */ }",
      '    await clearSession()',
      '    setSession(null)',
      '  }, [])',
    ].join('\n')
    expect(() => hardened(signOutBlock(track))).toThrow(/missing: if \(signingOutRef/)
    // Every piece present but the order wrong (the row before the blob is
    // cleared) is not hardened either — the order is the point.
    const reordered = signOutBlock(src).replace('await clearSession()', 'CLEAR').replace('await recordAuthEvent(event)', 'await clearSession()').replace('CLEAR', 'await recordAuthEvent(event)')
    expect(hardened(reordered)).toBe(false)
  })
})
