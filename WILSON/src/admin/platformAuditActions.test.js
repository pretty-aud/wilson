// =============================================================================
// platformAuditActions.test.js — Session 41
//
// The `platform_audit.action` vocabulary is declared in THREE places and has,
// until now, been kept in step only by comments in each of them:
//
//   1. the SQL CHECK          — supabase/migrations/*.sql (0028, widened by
//                               0031, widened again by 0055)
//   2. the TypeScript union   — supabase/functions/_shared/operatorGuard.ts
//                               (PlatformAuditFields)
//   3. the console filter     — src/admin/AuditSection.jsx (ACTIONS)
//
// 🚨 THE THREE FAIL IN THREE DIFFERENT DIRECTIONS, WHICH IS WHY COMMENTS WERE
// NEVER GOING TO HOLD THEM TOGETHER:
//
//   * A union NARROWER than the CHECK makes a legal action unloggable from
//     TypeScript. Session 20 found exactly this drift — the union had been
//     missing 'operator.granted' and 'operator.revoked' since S15. Inert, only
//     because nothing logged them.
//   * A union WIDER than the CHECK makes the INSERT fail, and logPlatformEvent
//     reports that on the error channel rather than throwing — so the operator's
//     action still returns 200 and NO CERTIFICATE EXISTS. Silent, and the
//     failure is a missing audit record, which is the one thing nobody looks at
//     until they need it.
//   * A filter list missing an entry is silent BY CONSTRUCTION. The rows land
//     in the table; only the dropdown cannot reach them. AuditSection's own
//     comment has said so since S20 and it drifted anyway — Session 41 added
//     four actions, updated the CHECK and the union, and missed this list. It
//     was caught by reading, not by any test, which is what this file fixes.
//
// Nothing in the repo pinned them against each other before this. All three are
// parsed from source text rather than imported, because the SQL and the Deno
// function cannot be imported into vitest.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const url = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(url(rel), 'utf8')

// 🚨 ONE ALTERNATING PASS, BLOCK ALTERNATIVE FIRST. S39 lost 40 lines of real
// code to a stripper that ran block comments in a separate earlier pass: a LINE
// comment containing `/*` then opened a block that ate everything up to the next
// `*/`. Alternation in a single pass cannot do that.
// This matters here more than anywhere: all three files DOCUMENT the action
// values in prose, so a parser that does not strip comments reads the
// documentation as declarations and every list agrees with every other.
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, '')

/** The CHECK as the LAST migration to widen it leaves it. */
function actionsFromSql() {
  const dir = url('../../supabase/migrations')
  const owning = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => /ADD\s+CONSTRAINT\s+platform_audit_action_check/i.test(readFileSync(`${dir}/${f}`, 'utf8')))
    .sort()
  // Not an assertion about a number: whichever migration widens it LAST is the
  // one in force, so this must never be hardcoded to 0031 or 0055.
  expect(owning.length).toBeGreaterThan(0)
  const sql = stripSql(readFileSync(`${dir}/${owning[owning.length - 1]}`, 'utf8'))
  const at = sql.search(/ADD\s+CONSTRAINT\s+platform_audit_action_check/i)
  expect(at).toBeGreaterThan(-1)
  const tail = sql.slice(at)
  const close = tail.indexOf('));')
  expect(close).toBeGreaterThan(-1)
  return new Set([...tail.slice(0, close).matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]))
}

/** The union, from its declaration only — not from the prose around it. */
function actionsFromUnion() {
  const ts = stripJs(read('../../supabase/functions/_shared/operatorGuard.ts'))
  const at = ts.indexOf('export type PlatformAuditFields')
  expect(at).toBeGreaterThan(-1)
  const tail = ts.slice(at)
  const end = tail.indexOf('message: string')
  expect(end).toBeGreaterThan(-1)
  return new Set([...tail.slice(0, end).matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]))
}

/** The console's filter dropdown. */
function actionsFromFilter() {
  const jsx = stripJs(read('./AuditSection.jsx'))
  const at = jsx.indexOf('const ACTIONS = [')
  expect(at).toBeGreaterThan(-1)
  const tail = jsx.slice(at)
  const end = tail.indexOf('\n]')
  expect(end).toBeGreaterThan(-1)
  return new Set([...tail.slice(0, end).matchAll(/\['([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]))
}

describe('platform_audit.action — the three declarations agree', () => {
  const sql = actionsFromSql()
  const union = actionsFromUnion()
  const filter = actionsFromFilter()

  // The parsers are the weak point, not the lists. If a regex silently matches
  // nothing, every set is empty and every comparison below passes — the exact
  // vacuity this repo has been bitten by. Anchor on a value that has existed
  // since 0028 and on a plausible floor.
  it('CONTROL: each list parsed to something real', () => {
    for (const [name, set] of [['sql', sql], ['union', union], ['filter', filter]]) {
      expect(set.size, `${name} parsed to nothing — the parser is broken, not the list`)
        .toBeGreaterThanOrEqual(15)
      expect(set.has('workspace.teardown'), `${name} is missing a value present since 0028`).toBe(true)
    }
  })

  it('the TypeScript union is not NARROWER than the CHECK (a legal action would be unloggable)', () => {
    expect([...sql].filter((a) => !union.has(a)).sort()).toEqual([])
  })

  it('the TypeScript union is not WIDER than the CHECK (the insert would fail on the error channel, silently)', () => {
    expect([...union].filter((a) => !sql.has(a)).sort()).toEqual([])
  })

  it('the operator console can filter every action the database admits', () => {
    // The failure this catches is silent by construction: the rows are written
    // and stored correctly, and only the dropdown cannot reach them.
    expect([...sql].filter((a) => !filter.has(a)).sort()).toEqual([])
  })

  it('the console offers no filter for an action the database would reject', () => {
    expect([...filter].filter((a) => !sql.has(a)).sort()).toEqual([])
  })

  it('Session 41’s four storage_plan actions are in all three', () => {
    for (const a of ['storage_plan.set', 'storage_plan.cleared',
      'storage_plan.suspended', 'storage_plan.restored']) {
      expect(sql.has(a), `SQL CHECK missing ${a}`).toBe(true)
      expect(union.has(a), `PlatformAuditFields missing ${a}`).toBe(true)
      expect(filter.has(a), `AuditSection ACTIONS missing ${a}`).toBe(true)
    }
  })
})
