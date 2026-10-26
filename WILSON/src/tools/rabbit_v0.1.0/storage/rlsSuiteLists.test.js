// =============================================================================
// rlsSuiteLists.test.js — VW1m (2026-10-16).
//
// Suite 100 (supabase/tests/rls/100_no_main_item.sql, migration 0097) is the
// first pgTAP suite with three digits, and three hand-kept lists did not know
// it could exist:
//
//   1. The root rls.yml's FAILURE-REPLAY list (the `for f in …` line of
//      "Capture logs on failure"). A suite missing from it still RUNS; it
//      simply never replays, so a red job cannot say which statement broke
//      (S17: suites 33-38 failed invisibly). It had stopped at 96: suites 98
//      and 99 were already missing when VW1m measured it. thumbnails.test.js
//      pins two names in it; this pins the WHOLE line against the directory,
//      in number order, so it cannot rot again.
//   2. rls.yml's per-table COVERAGE GUARD globbed `[0-9][0-9]_<table>.sql`,
//      which no suite numbered 100 or more can match. It now tries two and
//      three digits, each exact (a leading wildcard lets a column suite stand
//      in for a table's own: merge review round 2, A-R2-05).
//   3. scripts/tap-all.mjs sorted the names as TEXT (100 ran between 10 and
//      11) and filtered by PREFIX (`tap-all.mjs 10` ran 100 too). It now
//      orders by the leading number and a filter names a whole number.
//
// Each was shown failing on the old form before the new one went in.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { pickSuites } from '../../../../scripts/tap-all.mjs'

const APP = process.cwd()
const SUITE_DIR = join(APP, 'supabase', 'tests', 'rls')
// The app lives in WILSON/ and .github/ sits beside it at the git root.
const WORKFLOW = [resolve(APP, '..'), APP]
  .map((base) => resolve(base, '.github/workflows/rls.yml'))
  .find((p) => existsSync(p))

const leading = (file) => Number(/^(\d+)_/.exec(file)?.[1])

function workflowText() {
  expect(WORKFLOW, '.github/workflows/rls.yml not found — fix this path, do not delete this test').toBeTruthy()
  return readFileSync(WORKFLOW, 'utf8')
}

function replayList() {
  const line = workflowText().split(/\r?\n/).find((l) => /^\s*for f in supabase\/tests\/rls\//.test(l))
  expect(line, 'the replay step\'s `for f in supabase/tests/rls/…` line is missing').toBeTruthy()
  return [...line.matchAll(/supabase\/tests\/rls\/([^\s;]+\.sql)/g)].map((m) => m[1])
}

describe('rls.yml\'s failure-replay list', () => {
  it('names every suite file in supabase/tests/rls, and nothing else', () => {
    const files = readdirSync(SUITE_DIR).filter((f) => f.endsWith('.sql')).sort()
    const listed = replayList()
    expect([...listed].sort()).toEqual(files)
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('runs in number order, the three-digit suites after 99', () => {
    const listed = replayList()
    const numbers = listed.map(leading)
    expect(numbers.every(Number.isFinite)).toBe(true)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(listed).toContain('100_no_main_item.sql')
    // VW1c (2026-10-17): 0098's suite, which also covers item_groupings
    // (COVERED_BY), replays like every other; VW1e (2026-10-25): so does
    // 0099's, which covers no new table (this line is its only registration).
    expect(listed.slice(-2)).toEqual(['101_table_views.sql', '102_asset_level_links.sql'])
  })
})

describe('rls.yml\'s per-table coverage guard', () => {
  it('accepts a two- or a three-digit suite named exactly for its table', () => {
    const yml = workflowText()
    expect(yml).toContain('compgen -G "supabase/tests/rls/[0-9][0-9]_${t}.sql" >/dev/null')
    expect(yml).toContain('compgen -G "supabase/tests/rls/[0-9][0-9][0-9]_${t}.sql" >/dev/null')
    // The old two-digit-only test is gone (it could never see suite 100+).
    expect(yml).not.toContain('ls supabase/tests/rls/[0-9][0-9]_"${t}".sql')
  })
})

describe('scripts/tap-all.mjs picks suites by number', () => {
  const names = ['100_no_main_item.sql', '11_task_links.sql', '10_task_dependencies.sql',
    '9_x.sql', '99_task_items.sql', '01_projects.sql', 'README.md']

  it('orders by the leading number, not as text', () => {
    expect(pickSuites(names)).toEqual([
      '01_projects.sql', '9_x.sql', '10_task_dependencies.sql', '11_task_links.sql',
      '99_task_items.sql', '100_no_main_item.sql',
    ])
  })

  it('a filter names a whole number: 10 is not 100, and 100 is only 100', () => {
    expect(pickSuites(names, ['10'])).toEqual(['10_task_dependencies.sql'])
    expect(pickSuites(names, ['100'])).toEqual(['100_no_main_item.sql'])
    expect(pickSuites(names, ['1'])).toEqual(['01_projects.sql'])
  })

  // VW1c (2026-10-17): suite 101 (101_table_views.sql, 0098) is now the last.
  it('over the real directory, every suite once, 100, 101 then 102 last', () => {
    const files = readdirSync(SUITE_DIR)
    const picked = pickSuites(files)
    expect(picked).toHaveLength(files.filter((f) => f.endsWith('.sql')).length)
    expect(picked.slice(-3)).toEqual(['100_no_main_item.sql', '101_table_views.sql', '102_asset_level_links.sql'])
    expect(picked.indexOf('10_task_dependencies.sql')).toBeLessThan(picked.indexOf('11_task_links.sql'))
  })
})
