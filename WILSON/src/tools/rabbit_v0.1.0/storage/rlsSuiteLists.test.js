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
//
// MO1 (0114, docs/design/MOTH_DESIGN.md §2.1) keeps two more text pins here, on
// what the row-level rules assume of the code around them: rabbit_private stays
// out of the API's schemas (SFB-10), and no client source patches a file's
// guarded columns by hand (SB-8).
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
    // 0099's, which covers no new table (this line is its only registration);
    // B1 (2026-10-27): so does 0100's, 103_otter_subject_shares.sql, which
    // covers a table of its own (in RLS_TABLES too); R1 (2026-10-27): and
    // 0101's, suite 104, which covers no table either; M2 (2026-10-28): and
    // 0103's, suite 106, which covers none (105 stays reserved); P8
    // (2026-10-28): and 0104's, 0105's and 0106's, suites 107, 108 and 109,
    // columns, functions and policies on tables with suites of their own; MO1
    // (2026-11-02): and 0107's, suite 110, policies and guards on tables with
    // suites of their own; 0108's, suite 111, functions, a column and a
    // policy on tables with suites of their own; 0109's, suite 112, functions
    // and realtime policies, no table; 0111's, suite 113, functions, a trigger
    // and an index, no table; 0113's, suite 114, the file_moves table, which
    // is in RLS_TABLES too; 0114's, suite 115, helpers, a guard and a re-key, no
    // table; and 0117's: suites 116 and 117, network_share_checks and
    // network_share_ops, both in RLS_TABLES too, and suite 118, no table.
    // 0118's: suites 119 and 120, no table. 0121's: suite 122, no table. 0120's:
    // suite 123, whose one table is private, outside what RLS_TABLES lists. MO2's
    // 0122: suite 124, no table; 0123: suites 125 and 126, moth_views and
    // moth_layout_positions, both in RLS_TABLES too (suite 57 carries moth_prefs). MO3's 0125: suite 21 extended;
    // 0126: suites 127 to 130, the four tag tables; 0127: suites 131 and 132, moth_relationships and
    // moth_mention_reservations; each table in RLS_TABLES. 0128 and 0129: suite 133, the record of the four, no table.
    expect(listed.slice(-9)).toEqual(['125_moth_views.sql', '126_moth_layout_positions.sql', '127_moth_tag_types.sql', '128_moth_tags.sql', '129_moth_tag_assignments.sql', '130_moth_tag_nominations.sql', '131_moth_relationships.sql', '132_moth_mention_reservations.sql', '133_moth_history_s3.sql'])
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

  // VW1c (2026-10-17): suite 101 (101_table_views.sql, 0098) was the last;
  // B1 (2026-10-27): 103_otter_subject_shares.sql (0100) was; R1
  // (2026-10-27): 104_versions_and_items_realtime.sql (0101) was; M2
  // (2026-10-28): 106_project_status_desktop_values.sql (0103) was; P8
  // (2026-10-28): 109_s3_endpoint_public_hosts.sql (0106) was; MO1
  // (2026-11-02): 110_private_project_write_hops.sql (0107) was;
  // 111_private_project_money_and_history.sql (0108) was;
  // 112_private_project_channels.sql (0109) was;
  // 113_moth_read_path.sql (0111) was;
  // 114_file_moves.sql (0113) was;
  // 115_stable_file_bodies.sql (0114) was;
  // 116_network_share_checks.sql, 117_network_share_ops.sql and
  // 118_network_share_catalogue.sql (0117) are.
  it('over the real directory, every suite once, 115, 116, 117, 118, 119 then 120 last', () => {
    const files = readdirSync(SUITE_DIR)
    const picked = pickSuites(files)
    expect(picked).toHaveLength(files.filter((f) => f.endsWith('.sql')).length)
    expect(picked.slice(-10)).toEqual(['124_moth_graph_reads.sql', '125_moth_views.sql', '126_moth_layout_positions.sql', '127_moth_tag_types.sql', '128_moth_tags.sql', '129_moth_tag_assignments.sql', '130_moth_tag_nominations.sql', '131_moth_relationships.sql', '132_moth_mention_reservations.sql', '133_moth_history_s3.sql'])
    expect(picked.indexOf('10_task_dependencies.sql')).toBeLessThan(picked.indexOf('11_task_links.sql'))
  })
})

// SFB-10: the helpers in rabbit_private are reached by policies and triggers,
// never by a client's request. One word in config.toml would hand all of them to
// PostgREST, and nothing else would notice.
describe('supabase/config.toml keeps rabbit_private out of the API (0114, SFB-10)', () => {
  // The [api] table's `schemas` list, on one line or several. Null when there is
  // none, so a config this reader can no longer read fails instead of passing.
  function apiSchemas(toml) {
    const lines = toml.split(/\r?\n/)
    const at = lines.findIndex((l) => /^\s*\[api\]\s*(#.*)?$/.test(l))
    if (at === -1) return null
    const next = lines.findIndex((l, i) => i > at && /^\s*\[/.test(l))
    const table = lines.slice(at + 1, next === -1 ? undefined : next).join('\n')
    const list = /^\s*schemas\s*=\s*\[([^\]]*)\]/m.exec(table)
    return list ? [...list[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]) : null
  }

  it('api.schemas names public and never rabbit_private', () => {
    const schemas = apiSchemas(readFileSync(join(APP, 'supabase', 'config.toml'), 'utf8'))
    expect(schemas, 'no [api] schemas list in supabase/config.toml: fix this reader, do not delete this test').toContain('public')
    expect(schemas).not.toContain('rabbit_private')
  })

  it('CONTROL: the reader sees it planted, on one line or several, and only in [api]', () => {
    const planted = apiSchemas('[db]\nport = 1\n\n[api]\r\nenabled = true\r\nschemas = ["public", "rabbit_private"]\r\n\r\n[auth]\nschemas = []\n')
    expect(planted).toContain('rabbit_private')
    expect(apiSchemas('[api]\nschemas = [\n  "public",\n  "rabbit_private",\n]\n')).toContain('rabbit_private')
    expect(apiSchemas('[db]\nschemas = ["rabbit_private"]\n[api]\nschemas = ["public"]\n')).toEqual(['public'])
    expect(apiSchemas('[db]\nport = 1\n')).toBeNull()
  })
})

// SB-8: a client never changes where a file is kept or filed. updateFile strips
// those columns from its patch and rekey_file_body is the one way to change a key,
// so a `.from('files').update(` or `.upsert(` that names one is a write the guard
// will refuse (42501) once 0114 is on. A computed key is refused with them: the old
// re-file wrote `{ [column]: to }`, and this scan cannot read what `column` holds.
// A builder kept in a variable or handed on is refused too, because the scan could
// not follow it. What it cannot see is a table name in a variable, `.from(table)`.
describe('no client source patches a file\'s guarded columns (0114, SB-8)', () => {
  const GUARD_SQL = readFileSync(join(APP, 'supabase', 'migrations', '0114_stable_file_bodies.sql'), 'utf8')
  // The list is read from the guard's own Arm 1, so the two cannot drift apart.
  const armOne = GUARD_SQL.slice(GUARD_SQL.indexOf('-- Arm 1.'), GUARD_SQL.indexOf('-- Arm 2.'))
  const GUARDED = [...armOne.matchAll(/NEW\.(\w+) IS DISTINCT FROM OLD\./g)].map((m) => m[1])
  const SOURCE = /\.(js|jsx|ts|tsx|mjs|cjs)$/

  /**
   * Each `.from('files').update(…)` or `.upsert(…)` argument in a source text, read
   * to its closing bracket. A bracket inside a quoted string is not one, and a ' or
   * " string ends with its line, so an apostrophe in a comment cannot swallow the rest.
   */
  function fileWrites(text) {
    const found = []
    for (const m of text.matchAll(/\.from\(\s*['"`]files['"`]\s*\)\s*\.(?:update|upsert)\(/g)) {
      const start = m.index + m[0].length
      let depth = 1
      let quote = null
      let i = start
      while (i < text.length && depth > 0) {
        const c = text[i]
        if (quote) {
          if (c === '\\') i += 1
          else if (c === quote || (c === '\n' && quote !== '`')) quote = null
        } else if (c === "'" || c === '"' || c === '`') quote = c
        else if (c === '(') depth += 1
        else if (c === ')') depth -= 1
        i += 1
      }
      found.push(text.slice(start, i - 1))
    }
    return found
  }
  /** How many `.from('files')` are not used at once, so the scan above cannot follow them. */
  function heldBuilders(text) {
    return [...text.matchAll(/\.from\(\s*['"`]files['"`]\s*\)(?!\s*\.)/g)].length
  }
  /** What one such argument names that it may not: guarded columns, or a key nobody can read. */
  function offences(argument) {
    const named = GUARDED.filter((c) => new RegExp(`\\b${c}\\b`).test(argument))
    return /\[[^\]]+\]\s*:/.test(argument) ? [...named, 'a computed key'] : named
  }
  function sourcesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name)
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourcesUnder(path)
      return SOURCE.test(e.name) && !/\.test\./.test(e.name) ? [path] : []
    })
  }

  it('reads the seven columns the design names from the guard itself', () => {
    expect(GUARDED).toEqual(expect.arrayContaining(['project_id', 'workspace_id', 'folder_id', 'storage_provider', 'storage_path', 'thumbnail_url', 'is_financial']))
  })

  it('no .from(\'files\').update( or .upsert( under src/ or electron/ names one in its literal', () => {
    const found = [join(APP, 'src'), join(APP, 'electron')].flatMap(sourcesUnder).flatMap((file) => (
      fileWrites(readFileSync(file, 'utf8')).flatMap((argument) => {
        const names = offences(argument)
        return names.length ? [`${file.slice(APP.length + 1).replace(/\\/g, '/')}: ${names.join(', ')}`] : []
      })
    ))
    expect(found).toEqual([])
  })

  it('CONTROL: the scan bites on a literal, on two lines, in any quotes and on a computed key, and passes what it should', () => {
    const scan = (text) => fileWrites(text).flatMap(offences)
    expect(scan(".from('files').update({ is_financial: true, storage_path: to })")).toEqual(['storage_path', 'is_financial'])
    expect(scan('client\n  .from("files")\n  .update({\n    folder_id: x,\n  })\n  .eq("id", id)')).toEqual(['folder_id'])
    expect(scan('.from(`files`).update({ ...patch, thumbnail_url: (a || b) })')).toEqual(['thumbnail_url'])
    expect(scan(".from('files').update({ [column]: to })")).toEqual(['a computed key'])
    // The one sanctioned writer hands over a variable it has stripped already.
    expect(scan(".from('files').update(row).eq('id', id)")).toEqual([])
    expect(scan(".from('files').update({ description: note, tags })")).toEqual([])
    // A word inside a string counts too: the safe direction for a text scan.
    expect(scan(".from('files').update({ description: 'see storage_path' })")).toEqual(['storage_path'])
    expect(scan(".from('folders').update({ project_id: x })")).toEqual([])
    expect(scan(".from('files').select('project_id, storage_path')")).toEqual([])
  })

  it('CONTROL (review): an upsert is a write too', () => {
    const scan = (text) => fileWrites(text).flatMap(offences)
    expect(scan(".from('files').upsert({ folder_id: x })")).toEqual(['folder_id'])
    expect(scan('client\n  .from("files")\n  .upsert({ id, thumbnail_url: x }, { onConflict: "id" })')).toEqual(['thumbnail_url'])
    expect(scan(".from('folders').upsert({ project_id: x })")).toEqual([])
    expect(scan(".from('files').upsert(row)")).toEqual([])
  })

  it('CONTROL (review): a bracket inside a string does not end the argument, in any quotes, nor an apostrophe in a comment start a string', () => {
    const scan = (text) => fileWrites(text).flatMap(offences)
    expect(scan(".from('files').update({ description: 'done :)', storage_path: to })")).toEqual(['storage_path'])
    expect(scan('.from(\'files\').update({ description: "a ) b", folder_id: x })')).toEqual(['folder_id'])
    expect(scan('.from(\'files\').update({ description: `a ) b`, thumbnail_url: x })')).toEqual(['thumbnail_url'])
    expect(scan(".from('files').update({ description: 'it\\'s :)', is_financial: true })")).toEqual(['is_financial'])
    expect(scan(".from('files').update({ // don't\n  folder_id: x })")).toEqual(['folder_id'])
    expect(scan(".from('files').update({ // don't\n  description: x }).eq('storage_path', key)")).toEqual([])
    // A bracket opened inside a string does not hold the argument open either.
    expect(scan(".from('files').update({ description: '(' }).eq('storage_path', key)")).toEqual([])
  })

  it('CONTROL (review): a builder kept for later is flagged, wherever it goes, and one used at once is not', () => {
    expect(heldBuilders("const q = client.from('files')\nq.update({ storage_path: to })")).toEqual(1)
    expect(heldBuilders("const q = client.from('files');")).toEqual(1)
    expect(heldBuilders("wrap(client.from(\"files\"))")).toEqual(1)
    expect(heldBuilders("client.from('files').update(row)")).toEqual(0)
    expect(heldBuilders("const { data } = await client\n  .from('files')\n  .select('id')")).toEqual(0)
    expect(heldBuilders("const q = client.from('folders')")).toEqual(0)
  })

  it('no .from(\'files\') under src/ or electron/ is kept in a variable or handed on, where this scan could not follow it', () => {
    const found = [join(APP, 'src'), join(APP, 'electron')].flatMap(sourcesUnder).filter((file) => heldBuilders(readFileSync(file, 'utf8')) > 0)
    expect(found.map((file) => file.slice(APP.length + 1).replace(/\\/g, '/'))).toEqual([])
  })
})
