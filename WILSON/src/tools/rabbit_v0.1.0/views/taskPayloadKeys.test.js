// =============================================================================
// taskPayloadKeys.test.js — Session 28.
//
// A source-level guard, in the shape noHardcodedModels.test.js established, for
// a failure that is invisible at runtime until it bites in front of a user.
//
// WHAT HAPPENED. ProjectAssetsView applied a task template by sending
// `role_slug` on each created task. `tasks` has no such column — it has
// `assigned_role_slug`. And because `tasks` DOES have a COLUMN_ALLOWLIST entry,
// toColumns dropped the key with a console warning rather than rejecting the
// request. So the tasks were created, successfully, with no role on them, and
// every bid built from those tasks priced at nothing.
//
// 🚨 WHY THE ALLOWLIST TEST IS NOT ENOUGH. columnAllowlist.test.js pins that
// toColumns drops `role_slug` and keeps `assigned_role_slug` — the mechanism.
// It says nothing about which key the CALL SITE sends, so reverting the view
// would leave every one of those tests green. This closes that half.
//
// It is also the exact confusion worth guarding: the template's own field
// really IS called `role_slug` (it is a key inside the jsonb `tasks` array, not
// a column), so `tmplTask.role_slug` on the right-hand side is correct and must
// stay. Only the key being written to `tasks` is wrong. A blanket "no
// role_slug in src/" scan would be wrong twice over — TaskTemplateManager uses
// it legitimately, and `budget_lines` has a real `role_slug` COLUMN.
//
// So the scan is narrow on purpose: the argument object of an addTask() call,
// and nothing else.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(full, out)
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Every `addTask(` argument list in `src`, as raw text, with its file and the
 * 1-based line it starts on. Balanced-paren scan rather than a regex: these
 * payloads are multi-line object literals containing both braces and parens.
 */
function addTaskCallSites() {
  const sites = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    const re = /\baddTask\s*\(/g
    let m
    while ((m = re.exec(text)) !== null) {
      let depth = 1
      let i = re.lastIndex
      while (i < text.length && depth > 0) {
        const c = text[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        i++
      }
      sites.push({
        file: relative(SRC, file).replace(/\\/g, '/'),
        line: text.slice(0, m.index).split('\n').length,
        args: text.slice(re.lastIndex, i - 1),
      })
    }
  }
  return sites
}

describe('task write payloads', () => {
  const sites = addTaskCallSites()

  it('finds the call sites at all — the instrument works', () => {
    // Standing rule 2: before believing an absence, prove the instrument can
    // see a presence. A scan that silently matched nothing would pass the
    // assertion below forever.
    expect(sites.length).toBeGreaterThanOrEqual(3)
    expect(sites.some(s => s.file.includes('ProjectAssetsView'))).toBe(true)
  })

  it('no addTask() payload carries `role_slug` — the column is `assigned_role_slug`', () => {
    const offenders = sites
      .filter(s => /\brole_slug\s*:/.test(s.args))
      .map(s => `${s.file}:${s.line}`)
    expect(offenders, 'tasks has no role_slug column; toColumns would drop it ' +
      'with only a console warning and the task would be created with no role')
      .toEqual([])
  })

  it('the template branches do send the role under the right key', () => {
    // The positive half. Without this, deleting the line entirely would also
    // satisfy the check above — and a template that assigns no role is the
    // same broken bid, arrived at a different way.
    const assetsView = sites.filter(s => s.file.includes('ProjectAssetsView'))
    const withRole = assetsView.filter(s => /\bassigned_role_slug\s*:/.test(s.args))
    expect(withRole.length,
      'both template-application paths (create-with-template and ' +
      'apply-to-existing-asset) must set assigned_role_slug').toBe(2)
  })
})
