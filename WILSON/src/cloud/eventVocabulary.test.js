// =============================================================================
// eventVocabulary.test.js — Track A, bundle A4
//
// The `app_events` code vocabulary is declared in FOUR places and, until this
// file, was held together only by comments in each of them:
//
//   1. the WRITER            — a migration, an Edge Function, or a client call
//   2. the client registry   — src/cloud/errorCodes.js (ERROR_CODES)
//   3. the handbook          — docs/SYSTEMS_HANDBOOK.md Appendix B
//   4. the Admin Terminal    — LogsSection (event_type filter + describeErrorCode)
//                              and DiagnosticsSection (the code list)
//
// 🚨 THIS IS THE SAME SHAPE platformAuditActions.test.js WAS WRITTEN FOR, one
// vocabulary over. That file found, on its first run, two actions that had been
// in a CHECK for weeks and never in the console filter. This one found three:
// WIL-3005/3006/3007 are written by storage-secret and documented in the
// handbook, and have never been in ERROR_CODES — so the Logs view has been
// rendering "Unknown error code" for every one of them.
//
// Those three are exempted BY NAME below rather than quietly tolerated. They
// are Track C's codes and A4 was Track A's bundle; OUTSTANDING.md carries the
// entry. Anything NEW that drifts fails here.
//
// Everything is parsed from source text rather than imported: the SQL and the
// Deno functions cannot be imported into vitest.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

const errorCodesSrc = readFileSync(join(here, 'errorCodes.js'), 'utf8')
const handbook = readFileSync(join(root, 'docs', 'SYSTEMS_HANDBOOK.md'), 'utf8')
const logsSection = readFileSync(
  join(root, 'src', 'components', 'AdminTerminal', 'LogsSection.jsx'), 'utf8')
const diagnostics = readFileSync(
  join(root, 'src', 'components', 'AdminTerminal', 'DiagnosticsSection.jsx'), 'utf8')

/** Codes declared in the client registry, read from the source rather than
 *  imported so a syntax-level regression is visible here too. */
const registryCodes = new Set(
  [...errorCodesSrc.matchAll(/'(WIL-\d{4})':/g)].map(m => m[1]))

/**
 * Pre-existing drift, exempted by name. Adding a code here is a decision, not
 * a formality: it means the Admin Terminal shows "Unknown error code" for it.
 * See docs/OUTSTANDING.md and SYSTEMS_HANDBOOK.md Appendix B.
 */
const KNOWN_MISSING_FROM_REGISTRY = new Set(['WIL-3005', 'WIL-3006', 'WIL-3007'])

/** Every code any writer in the tree actually emits, with where it came from. */
function writtenCodes() {
  const found = new Map()
  const add = (code, where) => {
    if (!found.has(code)) found.set(code, new Set())
    found.get(code).add(where)
  }
  const scan = (dir, exts) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) { scan(p, exts); continue }
      if (!exts.some(e => entry.name.endsWith(e))) continue
      if (entry.name.includes('.test.')) continue
      const text = readFileSync(p, 'utf8')
      // A WRITE, not a mention: the code appears as a quoted scalar next to a
      // `code` key/column. Matching bare WIL-#### anywhere would sweep up every
      // comment and doc reference and make this assertion meaningless.
      for (const m of text.matchAll(/code:\s*'(WIL-\d{4})'/g)) add(m[1], entry.name)
      for (const m of text.matchAll(/'(WIL-\d{4})',\s*$/gm)) add(m[1], entry.name)
    }
  }
  scan(join(root, 'supabase', 'functions'), ['.ts'])
  scan(join(root, 'supabase', 'migrations'), ['.sql'])
  scan(join(root, 'src'), ['.js', '.jsx'])
  return found
}

describe('WIL-4108 — the self-approval line (A4, migration 0069)', () => {
  it('1. the WRITER emits it, in the migration that owns it', () => {
    const sql = readFileSync(
      join(root, 'supabase', 'migrations',
           '0069_otter_nomination_self_approval_audit.sql'), 'utf8')
    // Exactly once IN THE FUNCTION BODY. Counting over the whole file gets 2
    // and always will: the post-condition block greps for the same string to
    // prove the arm survived. Slice first, then count — asserting over the
    // whole file is how this test failed on its own first run.
    const body = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.otter_nomination_apply'),
      sql.indexOf('-- Restated rather than assumed.'))
    expect([...body.matchAll(/'WIL-4108'/g)]).toHaveLength(1)
    expect(body).toContain('IF v_nom.proposed_by = v_uid THEN')
  })

  it('🚨 2. …and the write is gated on the proposer being the caller', () => {
    const sql = readFileSync(
      join(root, 'supabase', 'migrations',
           '0069_otter_nomination_self_approval_audit.sql'), 'utf8')
    const gate = sql.indexOf('IF v_nom.proposed_by = v_uid THEN')
    const write = sql.indexOf("'WIL-4108'")
    const endIf = sql.indexOf('END IF;', gate)
    expect(gate).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(gate)
    expect(write).toBeLessThan(endIf)
  })

  it('3. the client registry describes it', () => {
    expect(registryCodes.has('WIL-4108')).toBe(true)
    expect(errorCodesSrc).toContain("'WIL-4108': 'Nomination approved by its own proposer'")
  })

  it('4. the handbook Appendix B carries a row for it', () => {
    const appendixB = handbook.slice(handbook.indexOf('## Appendix B'))
    expect(appendixB).toContain('`WIL-4108`')
  })

  it('🚨 5. the Admin Terminal can actually reach it', () => {
    // Two halves, and only one of them is automatic. describeErrorCode() reads
    // ERROR_CODES, so the tooltip follows #3 by itself — but the FILTER is a
    // hardcoded list of event_type values, and a row whose type is absent from
    // it is unreachable in the dropdown while sitting in the table. That is the
    // silent-by-construction failure AuditSection drifted into twice.
    // 🚨 NOT a bare toContain over the file. The first version of this line was
    // exactly that, and it SURVIVED the mutation that deleted the import —
    // because the call site still spelled the identifier. Assert the import and
    // the call separately, which is the difference between "the word appears"
    // and "the function is wired".
    expect(logsSection).toMatch(
      /import\s*\{[^}]*\bdescribeErrorCode\b[^}]*\}\s*from\s*'\.\.\/\.\.\/cloud\/errorCodes'/)
    expect(logsSection).toContain('describeErrorCode(event.code)')
    const eventTypes = logsSection.match(/const EVENT_TYPES = \[(.*?)\]/s)
    expect(eventTypes, 'EVENT_TYPES list not found in LogsSection').toBeTruthy()
    expect(eventTypes[1]).toContain("'admin'")
    // Diagnostics enumerates the registry live, so it needs no per-code edit —
    // asserted so that a change to a hardcoded list there would surface here.
    expect(diagnostics).toContain('Object.entries(ERROR_CODES)')
  })
})

describe('the four places do not drift', () => {
  it('🚨 every code a writer emits is in the client registry', () => {
    const missing = []
    for (const [code, wheres] of writtenCodes()) {
      // 🚨 WIL-7xxx is the platform_audit band, a DIFFERENT vocabulary with a
      // different table, a different guard and its own test
      // (platformAuditActions.test.js). ERROR_CODES is the app_events registry
      // and has deliberately never held a 7xxx code. Sweeping them in here
      // produced 17 false findings on this file's first run.
      if (code.startsWith('WIL-7')) continue
      if (registryCodes.has(code)) continue
      if (KNOWN_MISSING_FROM_REGISTRY.has(code)) continue
      missing.push(code + ' (written by ' + [...wheres].join(', ') + ')')
    }
    expect(missing, 'codes written but absent from ERROR_CODES — the Logs view '
      + 'will render them as "Unknown error code"').toEqual([])
  })

  // NOTE: there is deliberately NO "every registry code has an Appendix B row"
  // assertion. Seven codes (WIL-2001/2002, 3001/3002, 4201/4202/4203) have
  // neither a row nor a band today, so that rule is not the convention this
  // repo actually follows — asserting it would have meant either seven more
  // exemptions or a red suite for a rule nobody agreed to. Appendix B is a
  // summary with bands, not a second registry. The gap is recorded in
  // OUTSTANDING.md; what IS pinned is that the code THIS bundle adds appears
  // in all four places (above).

  it('the exemption list is exactly the drift that was found, and no wider', () => {
    // A growing exemption list is how this kind of test stops meaning anything.
    // If one of these is fixed, delete it from the list — the assertion below
    // fails when an exemption is no longer needed.
    for (const code of KNOWN_MISSING_FROM_REGISTRY) {
      expect(registryCodes.has(code),
        code + ' is now in ERROR_CODES — remove it from KNOWN_MISSING_FROM_REGISTRY'
      ).toBe(false)
    }
    expect(KNOWN_MISSING_FROM_REGISTRY.size).toBe(3)
  })
})
