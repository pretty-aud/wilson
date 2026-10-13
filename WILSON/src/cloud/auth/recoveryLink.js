// =============================================================================
// recoveryLink — pure parser for the URL an invite / password-reset email
// lands on. No I/O, no React, no `window` — unit-tested in recoveryLink.test.js.
//
// Session 18. Extracted from ResetPasswordWizard's private
// parseRecoveryFragment() so the link shapes can be tested; that path had zero
// coverage (MASTER_PLAN §6 #68) and was carrying a defect nobody could see.
//
// -----------------------------------------------------------------------------
// WHY THERE ARE TWO SHAPES
// -----------------------------------------------------------------------------
// SHAPE 1 — "verify" (Session 18, what the templates now send).
//
//   /#/recovery?token_hash=<hash>&type=invite
//
// The email carries GoTrue's `{{ .TokenHash }}` to a page in OUR app, and
// nothing is spent until the user clicks a button that calls
// `verifyOtp({ token_hash, type })`.
//
// This exists because the old shape was being redeemed by machines. Measured
// on wilson-staging, 2026-07-31: two invites, one to a corporate domain and
// one to Gmail, were confirmed **12.0 s and 16.7 s** after they were sent —
// `email_confirmed_at`, `last_sign_in_at` set and both tokens cleared —
// before either human had opened the mail. A `{{ .ConfirmationURL }}` is a
// bare `GET /auth/v1/verify?token=…` link, and anything that follows links to
// scan them spends it. Whatever the specific agent was, the class of bug is
// "a GET mutates state", and moving redemption behind a click removes it.
//
// SHAPE 2 — "session" (GoTrue's implicit-grant redirect; still supported).
//
//   /#/recovery#access_token=…&refresh_token=…&type=recovery
//   /#access_token=…&refresh_token=…&type=recovery      (no hash-router prefix)
//
// What `{{ .ConfirmationURL }}` produces after GoTrue verifies. Links minted
// before this change are valid for up to 24 h, so both shapes are accepted.
//
// -----------------------------------------------------------------------------
// THE BUG THIS FIXES IN SHAPE 2
// -----------------------------------------------------------------------------
// The old parser required `type === 'recovery'` and returned null otherwise.
// GoTrue v2.194.0 (the version on all three projects) echoes the REQUESTED
// type back into the fragment — `internal/api/verify.go`:
//
//     q.Set("type", params.Type)
//     rurl = token.AsRedirectURL(rurl, q)
//
// so an invite comes back as `type=invite`, the parser returned null, and the
// invitee was told *"This link has already been used, or it has expired."*
// even when the link was live and untouched. Password resets said `recovery`
// and worked, which is why only invites ever looked broken.
//
// Both types are accepted here. See recoveryLink.test.js, which pins the old
// predicate so this cannot silently return.
// =============================================================================

/**
 * The only OTP types WILSON mints. GoTrue's EmailOtpType is wider
 * ('signup' | 'magiclink' | 'email_change' | 'email'), but nothing in this app
 * issues those, so anything else is treated as a malformed link rather than
 * handed to verifyOtp.
 */
const ACCEPTED_TYPES = new Set(['recovery', 'invite'])

function normaliseType(raw) {
  const t = (raw ?? '').trim().toLowerCase()
  return ACCEPTED_TYPES.has(t) ? t : null
}

/**
 * Parse a recovery / invite landing URL.
 *
 * Pure: pass the two strings in rather than reading `window`, so this is
 * testable under vitest's `environment: 'node'`.
 *
 * @param {string} hash    `window.location.hash`   (leading '#' optional)
 * @param {string} search  `window.location.search` (leading '?' optional)
 * @returns {{kind:'verify',  token_hash:string, type:string}
 *         | {kind:'session', access_token:string, refresh_token:string, type:string}
 *         | null}  null means "not a usable link" — the caller shows the
 *                  already-used / expired screen.
 */
export function parseRecoveryLink(hash, search) {
  const raw = typeof hash === 'string' ? hash : ''
  const qs = typeof search === 'string' ? search : ''

  // --- Shape 1: token_hash ---------------------------------------------------
  // It can arrive in the real query string (`/wilson/?token_hash=…#/recovery`)
  // or inside the hash-router segment (`/#/recovery?token_hash=…`). Which one
  // depends on where `{{ .SiteURL }}` puts its own path, so accept both rather
  // than depend on a dashboard setting we cannot read from here.
  const queries = []
  if (qs) queries.push(qs.replace(/^\?/, ''))
  const qIdx = raw.indexOf('?')
  if (qIdx !== -1) {
    // Terminate at any later '#'. A real URL has only one fragment, so this
    // cannot happen in traffic from GoTrue — but without it a stray '#' ends
    // up glued onto the `type` value, which silently fails the type check
    // rather than failing loudly. Defensive, and free.
    const afterQ = raw.slice(qIdx + 1)
    const hIdx = afterQ.indexOf('#')
    queries.push(hIdx === -1 ? afterQ : afterQ.slice(0, hIdx))
  }

  for (const q of queries) {
    const params = new URLSearchParams(q)
    const tokenHash = params.get('token_hash')
    if (!tokenHash) continue
    const type = normaliseType(params.get('type'))
    // A token_hash with an unusable type is malformed, not a reason to fall
    // through to shape 2 — there is no access_token in this shape anyway.
    if (!type) return null
    return { kind: 'verify', token_hash: tokenHash, type }
  }

  // --- Shape 2: implicit-grant fragment --------------------------------------
  // The tail after the LAST '#', so both the hash-router form
  // ('#/recovery#access_token=…') and the bare form ('#access_token=…') work.
  const tail = raw.includes('#') ? raw.slice(raw.lastIndexOf('#') + 1) : raw
  if (!tail.includes('access_token=')) return null

  const params = new URLSearchParams(tail)
  const type = normaliseType(params.get('type'))
  if (!type) return null

  const accessToken = params.get('access_token') ?? ''
  const refreshToken = params.get('refresh_token') ?? ''
  // setSession() needs both. Half a pair is a truncated link, and failing here
  // gives the "already used" screen instead of an opaque Supabase error.
  if (!accessToken || !refreshToken) return null

  return {
    kind: 'session',
    access_token: accessToken,
    refresh_token: refreshToken,
    type,
  }
}

/**
 * Does this URL look like an invite / recovery landing at all?
 *
 * Used by App.jsx to pick the 'recovery' auth mode before the wizard mounts.
 * Deliberately looser than parseRecoveryLink: a link that is malformed or
 * spent should still route INTO the wizard, so the user gets the explanation
 * rather than a login screen that silently ignores what they clicked.
 *
 * @param {string} hash    `window.location.hash`
 * @param {string} search  `window.location.search`
 */
export function looksLikeRecoveryLink(hash, search) {
  const raw = typeof hash === 'string' ? hash : ''
  const qs = typeof search === 'string' ? search : ''
  return (
    raw.startsWith('#/recovery') ||
    raw.includes('type=recovery') ||
    raw.includes('type=invite') ||
    raw.includes('token_hash=') ||
    qs.includes('token_hash=')
  )
}
