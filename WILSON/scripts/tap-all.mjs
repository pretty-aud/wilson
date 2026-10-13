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
// Usage, from WILSON/, with the CLI linked to the target project:
//     node scripts/tap-all.mjs            # every suite
//     node scripts/tap-all.mjs 48 52      # only suites whose file starts 48/52
// =============================================================================

import { readdirSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SUITE_DIR = 'supabase/tests/rls'
const only = process.argv.slice(2)

const suites = readdirSync(SUITE_DIR)
  .filter(f => f.endsWith('.sql'))
  .filter(f => only.length === 0 || only.some(p => f.startsWith(p)))
  .sort()

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
