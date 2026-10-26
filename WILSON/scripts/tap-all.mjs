#!/usr/bin/env node
// =============================================================================
// tap-all.mjs — Session 26.
//
// Runs EVERY pgTAP suite against the linked hosted project, one suite per
// transaction, and prints a single table of planned/collected/passed/failed.
//
// This exists because the standing rule is "run the whole pgTAP set before
// pushing a migration" and the machine WILSON is developed on has no Docker,
// so `supabase test db` cannot run locally — only in CI. Up to now that meant
// invoking scripts/tap-hosted.py by hand, 52 times, and reading 52 JSON blobs.
// Doing it by hand is how a suite gets skipped.
//
// 🚨 `collected` MUST equal `planned` for every suite. A pgTAP function the
// shim forgot to rewrite still RUNS and still burns a test number, but never
// reaches the collector — so the run reports fewer tests instead of failing,
// which is a harness that lies about coverage rather than about correctness.
// This script fails on that mismatch as loudly as on an assertion failure.
//
// VW1m (2026-10-16): suite 100 (100_no_main_item.sql, migration 0097) is the
// first with three digits. Sorting the names as text ran it between 10 and 11,
// and a filter matched by prefix, so `… 10` ran 100 too. Suites are now
// ordered by their leading NUMBER and a filter names a WHOLE number
// (pickSuites, pinned by src/tools/rabbit_v0.1.0/storage/rlsSuiteLists.test.js).
//
// Usage, from WILSON/, with the CLI linked to the target project:
//     node scripts/tap-all.mjs            # every suite, by number
//     node scripts/tap-all.mjs 48 52      # only suites 48 and 52 (not 480, not 520)
// =============================================================================

import { readdirSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SUITE_DIR = 'supabase/tests/rls'

// A suite's leading number (`100_no_main_item.sql` → 100); a name without one
// sorts last and no number filter picks it.
const leadingNumber = (file) => {
  const m = /^(\d+)_/.exec(file)
  return m ? Number(m[1]) : Infinity
}

// The suites to run, in the order to run them: every .sql file, by its
// leading number (ties by name), or only those whose number is one of `only`.
export function pickSuites(files, only = []) {
  const wanted = only.map(Number)
  return files
    .filter(f => f.endsWith('.sql'))
    .filter(f => wanted.length === 0 || wanted.includes(leadingNumber(f)))
    .sort((a, b) => leadingNumber(a) - leadingNumber(b) || (a < b ? -1 : a > b ? 1 : 0))
}

function main() {
  const suites = pickSuites(readdirSync(SUITE_DIR), process.argv.slice(2))

  if (suites.length === 0) {
    console.error('no suites matched')
    process.exit(1)
  }

  const work = mkdtempSync(join(tmpdir(), 'tapall-'))
  const rows = []
  let bad = 0

  for (const suite of suites) {
    const built = join(work, `${suite}.run.sql`)
    try {
      execFileSync('python', ['scripts/tap-hosted.py', built, join(SUITE_DIR, suite)], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch (err) {
      rows.push({ suite, verdict: 'BUILD FAILED', detail: String(err.stderr || err).slice(0, 200) })
      bad++
      continue
    }

    let out
    try {
      out = execFileSync('supabase', ['db', 'query', '--linked', '--file', built], {
        encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      })
    } catch (err) {
      rows.push({ suite, verdict: 'QUERY FAILED', detail: String(err.stdout || err.stderr || err).slice(0, 300) })
      bad++
      continue
    }

    // The CLI prints a banner before the JSON body; take the first {...} block.
    const start = out.indexOf('{')
    let parsed = null
    try { parsed = JSON.parse(out.slice(start)) } catch { /* handled below */ }
    const r = parsed?.rows?.[0]
    if (!r) {
      rows.push({ suite, verdict: 'NO VERDICT', detail: out.slice(-300) })
      bad++
      continue
    }

    const planned = Number(r.planned)
    const collected = Number(r.collected)
    const failed = Number(r.failed)
    // Both conditions matter, and the second is the subtle one: a suite can
    // report zero failures while having silently lost probes.
    const ok = failed === 0 && planned === collected
    if (!ok) bad++
    rows.push({
      suite, verdict: ok ? 'ok' : 'FAIL',
      planned, collected, passed: Number(r.passed), failed,
      detail: ok ? '' : (r.failures || `planned ${planned} != collected ${collected}`),
    })
    process.stdout.write(ok ? '.' : 'X')
  }

  process.stdout.write('\n\n')
  const totals = rows.reduce((a, r) => ({
    planned: a.planned + (r.planned || 0),
    passed:  a.passed  + (r.passed  || 0),
    failed:  a.failed  + (r.failed  || 0),
  }), { planned: 0, passed: 0, failed: 0 })

  for (const r of rows) {
    if (r.verdict === 'ok') continue
    console.log(`\n${r.suite}: ${r.verdict}\n${r.detail}`)
  }

  console.log(`\nsuites: ${rows.length}  clean: ${rows.length - bad}  problem: ${bad}`)
  console.log(`assertions: planned ${totals.planned}  passed ${totals.passed}  failed ${totals.failed}`)
  process.exit(bad === 0 ? 0 : 1)
}

// Run only when executed (`node scripts/tap-all.mjs`), not when a test
// imports pickSuites.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
