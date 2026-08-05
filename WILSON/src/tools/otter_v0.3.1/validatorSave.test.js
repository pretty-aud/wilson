// =============================================================================
// validatorSave.test.js — Session 30.
//
// A source-level guard, in the shape taskPayloadKeys.test.js established, for
// the defect that made the Validator lose Audrey's corrections.
//
// WHAT HAPPENED, and it is two faults stacked so that neither was visible:
//
//   1. `electron/main.cjs` had GET and DELETE for /api/software/:slug/subjects/
//      :sub and no PUT, so against Local Server — where all six of her courses
//      live — every "Accept Fix" 404ed.
//   2. `applyFix` did not check `res.ok`. `otterFetch` resolves for every
//      status (fetch's own contract, and in cloud mode it BUILDS the Response
//      itself, adapters/index.js:127), so `await otterFetch(...)` succeeded on
//      that 404 and the fix was marked applied.
//
// Fault 1 alone would have shown an error. Fault 2 alone would have been
// harmless in cloud, which works. Together they produce a green tick over a
// write that never happened — and fixing only one of them still leaves a way
// to lose work silently, which is why both are pinned here.
//
// 🚨 THE SAME TRAP IS ALREADY WRITTEN DOWN ONE FILE AWAY, about a different
// write: supabaseOtterAdapter.js:253-255, "because no O.T.T.E.R. call site
// checks res.ok the UI would have reported every generated subject as saved
// while nothing at all was written." The knowledge existed and had not
// travelled to the call site.
//
// ⚠️ A STATED LIMIT, measured rather than assumed. Rendering FixCard's failure
// banner unreachable (`{false && …}`) leaves all 17 assertions GREEN — nothing
// here mounts React, so this suite pins the LOGIC of the save and says nothing
// about whether the refusal is visible on screen. That breaker was written
// expecting it to pass, and it did; recorded so nobody reads a green run as
// proof that the user is told.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const VALIDATOR = read('./Validator.jsx')
const MAIN_CJS = read('../../../electron/main.cjs')

/**
 * The body of a `const <name> = useCallback(` declaration, by balanced parens.
 * Scoping the assertions to one function is what stops them passing because
 * the strings happen to appear somewhere else in a 1000-line component.
 */
function callbackBody(source, name) {
  const start = source.indexOf(`const ${name} = useCallback(`)
  if (start === -1) return null
  let i = source.indexOf('(', start + `const ${name} = useCallback`.length)
  let depth = 1
  const from = ++i
  while (i < source.length && depth > 0) {
    const c = source[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    i++
  }
  return source.slice(from, i - 1)
}

/** Every Express route declared in main.cjs, as {verb, pattern}. */
function expressRoutes() {
  const out = []
  const re = /expressApp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g
  let m
  while ((m = re.exec(MAIN_CJS)) !== null) {
    out.push({ verb: m[1].toUpperCase(), pattern: m[2] })
  }
  return out
}

/** Does any Express route handle this concrete path + verb? */
function expressHandles(path, verb) {
  return expressRoutes().some(r => {
    if (r.verb !== verb) return false
    // `:param` matches one segment. Deliberately permissive: a literal route
    // such as /subjects/renumber also matches /subjects/<slug> under this
    // conversion. That only ever makes the check MILDER, never falsely red.
    const rx = new RegExp('^' + r.pattern.replace(/:[^/]+/g, '[^/]+') + '$')
    return rx.test(path)
  })
}

describe('the Validator saves what it says it saved', () => {
  const applyFix = callbackBody(VALIDATOR, 'applyFix')

  it('finds applyFix at all — the instrument works', () => {
    // Standing rule 2: prove the instrument can see a presence, or every
    // assertion below passes forever against a null body.
    expect(applyFix).not.toBeNull()
    expect(applyFix).toContain("method: 'PUT'")
  })

  it('checks res.ok before recording the fix as accepted', () => {
    const put = applyFix.indexOf("method: 'PUT'")
    const check = applyFix.indexOf('res.ok')
    const accepted = applyFix.indexOf("status: 'accepted'")

    expect(check, 'applyFix must test the response status — otterFetch resolves '
      + 'for 404 and 403 alike, so an unchecked await reports a refused save as '
      + 'a successful one').toBeGreaterThan(-1)
    expect(accepted, 'applyFix must record the accepted outcome').toBeGreaterThan(-1)
    expect(check, 'the status check has to come AFTER the request').toBeGreaterThan(put)
    expect(accepted, 'the fix may only be marked accepted AFTER the status check')
      .toBeGreaterThan(check)
  })

  it('reports every failure path to the user rather than the console', () => {
    // The old version ended two failure paths in a bare `return` and one in a
    // console.error. A user watching the screen saw nothing at all.
    expect(applyFix).not.toMatch(/console\.(warn|error)/)
    // Each early exit routes through the same reporter.
    expect((applyFix.match(/\bfail\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })
})

describe('Express serves every O.T.T.E.R. route the parser resolves locally', () => {
  // Hand-maintained on purpose, and narrow: only the non-cloudOnly routes that
  // Local Server is expected to answer. A generated list would have to encode
  // which ops are cloudOnly, which is the parser's job, not a test's.
  const REQUIRED = [
    ['/api/software', 'GET'],
    ['/api/software', 'POST'],
    ['/api/software/blender', 'GET'],
    ['/api/software/blender', 'DELETE'],
    ['/api/software/blender/subjects', 'GET'],
    ['/api/software/blender/subjects', 'POST'],
    ['/api/software/blender/subjects/intro', 'GET'],
    ['/api/software/blender/subjects/intro', 'DELETE'],
    // Session 30: the one that was missing. Validator.jsx:494-495.
    ['/api/software/blender/subjects/intro', 'PUT'],
    ['/api/software/blender/subjects/renumber', 'POST'],
    ['/api/software/blender/subjects/reorder', 'POST'],
    ['/api/software/blender/progress', 'GET'],
    ['/api/software/blender/progress', 'POST'],
  ]

  it('finds the Express routes at all — the instrument works', () => {
    const routes = expressRoutes()
    expect(routes.length).toBeGreaterThan(30)
    expect(routes.some(r => r.verb === 'PUT' && r.pattern.includes('/subjects/:sub'))).toBe(true)
  })

  it.each(REQUIRED)('handles %s %s', (path, verb) => {
    expect(expressHandles(path, verb),
      `no Express handler for ${verb} ${path} — against Local Server this 404s, `
      + 'and O.T.T.E.R. call sites that skip res.ok will read that as success')
      .toBe(true)
  })
})
