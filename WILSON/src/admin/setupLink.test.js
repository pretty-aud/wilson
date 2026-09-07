// =============================================================================
// setupLink.test.js — Session 43b
//
// The operator emails a company's admin a link to set their own password.
//
// 🚨 WHY THIS FILE EXISTS AT ALL. platformAuditActions.test.js guards three of
// the four places the audit vocabulary is declared — the SQL CHECK, the
// TypeScript union and the console filter. It does NOT guard the fourth: the
// CALL SITE. An action can be spelled correctly in all three lists and emitted
// with a typo, or never emitted at all, and nothing goes red.
//
// 🚨 AND THE ERROR VOCABULARY HAS THE SAME SHAPE. operatorApi's FRIENDLY map is
// documented as "every server error code needs an entry here or callOperatorFn
// falls back to `Request failed (<status>)` and the operator sees a bare
// number". S41 shipped that mistake. Worse than a missing entry is a WRONG one:
// this action first reused `confirmation_mismatch`, whose string reads "The
// slug you typed does not match" — over an EMAIL field. A code with the wrong
// noun is the same defect as no code, just quieter.
//
// Both lists are parsed from source: the Deno function cannot be imported into
// vitest, and operatorApi pulls in the Supabase client at module load.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const url = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(url(rel), 'utf8')

// One alternating pass, block alternative first — the S39 stripper lesson.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

const fn = read('../../supabase/functions/operator-workspaces/index.ts')
const fnCode = strip(fn)
const api = read('./operatorApi.js')
const apiCode = strip(api)

/**
 * The send_setup_link handler ONLY.
 *
 * 🚨 SCOPED, AND EVERY ASSERTION USES IT. The first version of this file
 * asserted several handler properties against the whole 1000-line file, so a
 * string appearing in ANY OTHER action satisfied a test named for this one.
 *
 * 🚨 AND IT PROVES IT FOUND THE BLOCK. indexOf returns -1 when an anchor moves,
 * and -1 is less than every real offset — so an unguarded toBeLessThan passes
 * VACUOUSLY the moment the string it looks for stops matching.
 */
function handlerBlock() {
  const start = fnCode.indexOf("if (action === 'send_setup_link')")
  expect(start, 'send_setup_link handler not found').toBeGreaterThan(-1)
  const rest = fnCode.slice(start + 10)
  const end = rest.indexOf("if (action === ")
  return end === -1 ? rest : rest.slice(0, end)
}

/** Every `error: 'code'` the send_setup_link handler can return. */
function codesFromHandler() {
  return [...handlerBlock().matchAll(/error:\s*'([a-z_]+)'/g)].map((m) => m[1])
}

function friendlyKeys() {
  const start = apiCode.indexOf('const FRIENDLY = {')
  const block = apiCode.slice(start, apiCode.indexOf('\n}', start))
  return new Set([...block.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]))
}

describe('send_setup_link — the action exists and is reachable', () => {
  it('🚨 is in the ACTIONS set — a handler missing from the closed enum never runs', () => {
    // The dispatcher rejects an unknown action with validation_failed/400
    // BEFORE any work. A handler absent from this Set reads as live code and is
    // unreachable — which is exactly what happened on the first draft of this
    // session.
    const setBlock = fnCode.slice(fnCode.indexOf('const ACTIONS = new Set(['))
    expect(setBlock.slice(0, 200)).toMatch(/'send_setup_link'/)
  })

  it('🚨 sits AFTER the workspace_id resolution — it targets an existing company', () => {
    const resolve = fnCode.indexOf('const workspaceId = typeof body.workspace_id')
    const handler = fnCode.indexOf("if (action === 'send_setup_link')")
    expect(resolve, 'workspace_id resolution not found').toBeGreaterThan(-1)
    expect(handler, 'handler not found').toBeGreaterThan(-1)
    expect(resolve).toBeLessThan(handler)
  })

  it('🚨 emits workspace.invite_sent — the fourth vocabulary place, guarded by nothing else', () => {
    expect(handlerBlock()).toMatch(/action:\s*'workspace\.invite_sent'/)
  })

  it('🚨 records the address it sent to — "we mailed the wrong place" is otherwise unanswerable', () => {
    expect(handlerBlock()).toMatch(/context:\s*\{\s*sent_to:/)
  })

  it('🚨 uses a FREE certificate code — WIL-7006 is already the blob.purged batch', () => {
    // WIL-7006 is emitted three times in this same file for blob.purged, and
    // SYSTEMS_HANDBOOK §17 registers it as exactly that. A duplicated code makes
    // the audit trail ambiguous precisely when someone is trying to read it.
    expect(handlerBlock()).not.toMatch(/WIL-7006/)
    expect(handlerBlock()).toMatch(/code:\s*'WIL-7009'/)
  })
})

describe('send_setup_link — the refusals', () => {
  const codes = codesFromHandler()

  it('🚨 refuses a synthesized @wilson.invalid address', () => {
    // `create` writes username.slug@wilson.invalid when the operator gives no
    // email. A SHAPE check cannot catch it — invite-member's own EMAIL_RE
    // accepts it — so the guard must test the suffix.
    expect(fnCode).toMatch(/'@wilson\.invalid'/)
    // 🚨 BOTH FORMATS. admin-create-user mints
    // wilson.<workspace8>.<local>@mail.petalstudios.co, which UsersSection
    // badges "no real inbox" on screen — reachable here whenever the founding
    // admin is deactivated and that member becomes the oldest active admin.
    expect(fnCode).toMatch(/'@mail\.petalstudios\.co'/)
    expect(codes).toContain('email_synthesized')
  })

  it('🚨 requires the operator to confirm the exact address', () => {
    // This hands over a company that ALREADY EXISTS, with a live admin
    // membership. A typo does not fail harmlessly; it mails a stranger a real
    // tenant.
    expect(handlerBlock()).toMatch(/body\.confirm_email/)
    expect(codes).toContain('email_mismatch')
  })

  it('🚨 does NOT reuse confirmation_mismatch — its string is about a slug', () => {
    expect(handlerBlock()).not.toMatch(/confirmation_mismatch/)
  })

  it('🚨 surfaces a failed send instead of reporting success over it', () => {
    expect(codes).toContain('send_failed')
    expect(handlerBlock()).toMatch(/if \(mailErr\)/)
  })

  it('🚨 refuses a SUSPENDED company — the link would work and the sign-in would not', () => {
    // workspaces_select filters `deleted_at IS NULL`, so the recipient would set
    // a password and then be unable to sign in, while the certificate asserts a
    // hand-over that never happened.
    expect(handlerBlock()).toMatch(/ws\.deleted_at/)
    expect(codes).toContain('already_suspended')
  })

  // ── ORDER, NOT PRESENCE ───────────────────────────────────────────────────
  it('🚨 EVERY GUARD RUNS BEFORE THE MAIL — presence alone passes on a handler that mails first', () => {
    const block = handlerBlock()
    const marks = {
      suspended: block.indexOf('ws.deleted_at'),
      synthesized: block.indexOf('isSynthesizedAddress'),
      confirm: block.indexOf('confirm_email'),
      send: block.indexOf('resetPasswordForEmail'),
    }
    for (const [name, i] of Object.entries(marks)) {
      expect(i, name + ' marker not found in the handler').toBeGreaterThan(-1)
    }
    expect(marks.suspended).toBeLessThan(marks.send)
    expect(marks.synthesized).toBeLessThan(marks.send)
    expect(marks.confirm).toBeLessThan(marks.send)
  })

  it('🚨 the certificate is written AFTER the send — never certifying a mail that failed', () => {
    const block = handlerBlock()
    const send = block.indexOf('resetPasswordForEmail')
    const cert = block.indexOf('logPlatformEvent')
    expect(send, 'send not found').toBeGreaterThan(-1)
    expect(cert, 'certificate not found').toBeGreaterThan(-1)
    expect(send).toBeLessThan(cert)
  })

  // ── FAILING CONTROL ───────────────────────────────────────────────────────
  it('CONTROL: the parser found real codes, not an empty list', () => {
    expect(codes.length).toBeGreaterThanOrEqual(4)
  })
})

describe('every code the handler returns has a FRIENDLY string', () => {
  it('🚨 or the operator sees `Request failed (409).` and learns nothing', () => {
    const friendly = friendlyKeys()
    const missing = codesFromHandler().filter((c) => !friendly.has(c))
    expect(missing).toEqual([])
  })

  // ── FAILING CONTROL ───────────────────────────────────────────────────────
  it('CONTROL: FRIENDLY parsed to something real', () => {
    const friendly = friendlyKeys()
    expect(friendly.size).toBeGreaterThan(10)
    expect(friendly.has('unauthorized')).toBe(true)
  })
})

describe('the client binding', () => {
  it('sends the confirmation through — a client that drops it always 400s', () => {
    expect(apiCode).toMatch(/action:\s*'send_setup_link'/)
    expect(apiCode).toMatch(/confirm_email:/)
  })

  it('🚨 the CALL SITE passes an argument — the wrapper declaring the param proves nothing', () => {
    // The first version of this test checked only operatorApi.js, which is the
    // file that DECLARES confirm_email and therefore always contains it. A
    // console calling sendWorkspaceSetupLink(id) with no second argument would
    // have passed it, and every send would 400.
    const ui = strip(read('./CompaniesSection.jsx'))
    expect(ui).toMatch(/sendWorkspaceSetupLink\(\s*row\.workspace_id\s*,\s*\w+/)
  })

  it('🚨 the console reads the admin contact and CHECKS the response', () => {
    // Without admin_contact the operator has no way to know the address the
    // server will demand back — no operator surface shows it.
    const ui = strip(read('./CompaniesSection.jsx'))
    expect(ui).toMatch(/getWorkspaceAdminContact\(/)
    // An unchecked read renders "Looking up the admin…" forever, which reads as
    // a hang rather than as a failure.
    expect(ui).toMatch(/if \(!res\.ok\)/)
  })

  it('🚨 the console calls it', () => {
    // Ten features in this repo have shipped with no caller. This is the grep
    // that would have caught them.
    const ui = strip(read('./CompaniesSection.jsx'))
    expect(ui).toMatch(/sendWorkspaceSetupLink\(/)
    expect(ui).toMatch(/import \{[\s\S]*?sendWorkspaceSetupLink[\s\S]*?\} from '\.\/operatorApi'/)
  })
})
