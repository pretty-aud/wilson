// =============================================================================
// fileTags.test.js — post-overhaul S4a (migration 0085, Audrey's E3/E4/E12).
//
// One vocabulary lives in three places: fileTags.js (the client),
// electron/fileTags.cjs (the Local Server's PATCH routes) and 0085's CHECK.
// Nothing at runtime ties them together, so this file does — and every rule
// below carries a PLANTED fault that the same assertion must catch, so a
// green run cannot mean "the check was blind".
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  FILE_TAGS, FILE_TAG_IDS, DERIVED_TAG, GATED_TAG, LEGAL_HINT, LEGAL_SEGMENT,
  LEGAL_LOCKED_REASON, LEGAL_AT_ADD_REASON,
  tagLabel, storedTags, displayTags, writableTags, toggleTag, tagSettable, tagsMatch, isLegalFile,
} from './fileTags'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const cjs = require(resolve(here, '../../../electron/fileTags.cjs'))
const migration = readFileSync(resolve(here, '../../../supabase/migrations/0085_file_tags.sql'), 'utf8')
const mainCjs = readFileSync(resolve(here, '../../../electron/main.cjs'), 'utf8')

const NINE = ['production', 'creative', 'legal', 'finance', 'reference', 'assets', 'code', 'shots', 'documentation']

/** The list inside files_tags_known_chk's ARRAY[…], in order. */
function checkList(sql) {
  const m = sql.match(/ADD CONSTRAINT files_tags_known_chk\s+CHECK \(tags <@ ARRAY\[([\s\S]*?)\]::TEXT\[\]\)/)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('the vocabulary: one list, in three places', () => {
  it('is the nine Audrey named (E3), in her order, lower case, and Notes is not one', () => {
    expect(FILE_TAG_IDS).toEqual(NINE)
    expect(FILE_TAGS.map((t) => t.label)).toEqual([
      'Production', 'Creative', 'Legal', 'Finance', 'Reference', 'Assets', 'Code', 'Shots', 'Documentation',
    ])
    expect(FILE_TAG_IDS).not.toContain('notes')
  })

  it('the Local Server copy and the migration CHECK are the same list', () => {
    expect([...cjs.FILE_TAG_IDS]).toEqual([...FILE_TAG_IDS])
    expect(checkList(migration)).toEqual([...FILE_TAG_IDS])
    expect(cjs.FILE_TAG_MAX).toBe(9)
    expect(migration).toMatch(/CHECK \(cardinality\(tags\) <= 9\)/)
    expect(migration).toMatch(/CHECK \(COALESCE\(array_ndims\(tags\), 1\) = 1\)/)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS tags TEXT\[\] NOT NULL DEFAULT '\{\}'/)
  })

  it('CONTROL: the CHECK reader sees a list that drifted (a tenth word, a dropped one)', () => {
    const widened = migration.replace("'shots', 'documentation'", "'shots', 'documentation', 'notes'")
    expect(widened).not.toBe(migration)
    expect(checkList(widened)).not.toEqual([...FILE_TAG_IDS])
    const narrowed = migration.replace("'legal', ", '')
    expect(narrowed).not.toBe(migration)
    expect(checkList(narrowed)).not.toEqual([...FILE_TAG_IDS])
  })

  it('touches no policy (0075\'s shape: a column is not a grant surface)', () => {
    const code = migration.replace(/--.*$/gm, '')
    expect(code).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/)
    expect(code).toMatch(/COMMENT ON COLUMN public\.files\.is_core_definer IS/)
  })
})

describe('what a row shows and what the client writes', () => {
  it('storedTags trusts only the nine, once each, in the vocabulary order', () => {
    expect(storedTags({ tags: ['shots', 'nonsense', 'creative', 'shots', null, 7] })).toEqual(['creative', 'shots'])
    expect(storedTags({})).toEqual([])
    expect(storedTags({ tags: 'creative' })).toEqual([])
  })

  it('Finance is shown from is_financial and from nowhere else (E4)', () => {
    expect(displayTags({ tags: [], is_financial: true })).toEqual(['finance'])
    expect(displayTags({ tags: ['finance'], is_financial: false })).toEqual([])
    expect(displayTags({ tags: ['shots', 'legal'], is_financial: true })).toEqual(['legal', 'finance', 'shots'])
  })

  it('the client never WRITES Finance, whatever it is handed', () => {
    expect(writableTags(['finance', 'code'])).toEqual(['code'])
    expect(toggleTag({ tags: ['code'], is_financial: true }, 'shots')).toEqual(['code', 'shots'])
    expect(toggleTag({ tags: ['code', 'shots'] }, 'code')).toEqual(['shots'])
  })

  it('CONTROL: a writer that forgets the Finance rule is caught by the same assertion', () => {
    const naive = (ids) => storedTags({ tags: ids })
    expect(naive(['finance', 'code'])).not.toEqual(['code'])
  })

  it('who may set what: Finance and Legal never (facts about the file), the rest with write access', () => {
    expect(tagSettable(DERIVED_TAG, { canWrite: true, canSeeMoney: true }).ok).toBe(false)
    // S4b (0088): Legal is chosen when the file is added — for NOBODY after,
    // the money gate included (Audrey: "its just the folder that is locked").
    expect(tagSettable(GATED_TAG, { canWrite: true, canSeeMoney: true }).ok).toBe(false)
    expect(tagSettable(GATED_TAG, { canWrite: true, canSeeMoney: false }).ok).toBe(false)
    expect(tagSettable(GATED_TAG, { canWrite: true, canSeeMoney: true, legal: true }).reason).toBe(LEGAL_LOCKED_REASON)
    expect(tagSettable(GATED_TAG, { canWrite: true, canSeeMoney: true, legal: false }).reason).toBe(LEGAL_AT_ADD_REASON)
    expect(tagSettable('shots', { canWrite: false, canSeeMoney: true }).ok).toBe(false)
    expect(tagSettable('shots', { canWrite: true, canSeeMoney: false }).ok).toBe(true)
    // The hint is the truth now, not "not restricted yet".
    expect(LEGAL_HINT).toBe('Only project managers and workspace admins can see this file.')
    expect(LEGAL_LOCKED_REASON).toBe('Added as Legal. To change this, add the file again.')
  })

  it('Legal is never toggled: asked to, toggleTag returns the tags unchanged (and keeps legal on a Legal file)', () => {
    expect(toggleTag({ tags: ['code'] }, GATED_TAG)).toEqual(['code'])
    expect(toggleTag({ tags: ['legal', 'code'] }, GATED_TAG)).toEqual(['legal', 'code'])
    // Other tags still toggle on a Legal file, and the legal tag rides along —
    // files_legal_folder_chk would refuse a write that dropped it.
    expect(toggleTag({ tags: ['legal'] }, 'shots')).toEqual(['legal', 'shots'])
    expect(toggleTag({ tags: ['legal', 'shots'] }, 'shots')).toEqual(['legal'])
  })

  it('isLegalFile: the tag, or a LEGAL third path segment in any case; nothing else', () => {
    expect(isLegalFile({ tags: ['legal'] })).toBe(true)
    expect(isLegalFile({ storage_path: 'projects/p/LEGAL/p/1-a.pdf' })).toBe(true)
    expect(isLegalFile({ storage_path: 'projects/p/legal/p/1-a.pdf', tags: [] })).toBe(true)
    expect(isLegalFile({ storage_path: 'projects/p/project/p/1-legal.pdf', tags: ['shots'] })).toBe(false)
    expect(isLegalFile({ storage_path: 'projects/p/INVOICES/p/1-a.pdf', is_financial: true })).toBe(false)
    expect(isLegalFile({ storage_path: 'LEGAL' })).toBe(false)
    expect(isLegalFile(null)).toBe(false)
    expect(isLegalFile({})).toBe(false)
    expect(LEGAL_SEGMENT).toBe('LEGAL')
  })

  it('the filter matches a tag by its word, Finance included', () => {
    expect(tagsMatch({ tags: ['shots'] }, 'shot')).toBe(true)
    expect(tagsMatch({ tags: ['shots'] }, 'Shots')).toBe(true)
    expect(tagsMatch({ tags: [], is_financial: true }, 'finance')).toBe(true)
    expect(tagsMatch({ tags: ['shots'] }, 'legal')).toBe(false)
    expect(tagsMatch({ tags: ['shots'] }, '')).toBe(false)
    expect(tagLabel('documentation')).toBe('Documentation')
  })
})

describe('the Local Server refuses what the cloud refuses (electron/fileTags.cjs)', () => {
  const REFUSED = [
    { tags: ['notes'] },                // E3 removed it
    { tags: ['Production'] },           // case
    { tags: [null] },                   // a null element
    { tags: null },                     // not a list
    { tags: 'shots' },                  // not a list
    { tags: [...NINE, 'code'] },        // a tenth element
    { tags: [['code', 'legal']] },      // two dimensions (0085's files_tags_flat_chk)
  ]
  const ACCEPTED = [{}, { description: 'x' }, { tags: [] }, { tags: [...NINE] }, { tags: ['shots', 'shots'] }]
  /** Where `check` disagrees with the database: [] when it agrees. */
  const disagreements = (check) => [
    ...REFUSED.filter((body) => check(body).ok !== false),
    ...ACCEPTED.filter((body) => check(body).ok !== true),
  ].map((body) => JSON.stringify(body))

  it('answers like files_tags_known_chk, files_tags_len_chk and files_tags_flat_chk', () => {
    expect(disagreements(cjs.checkFileTags)).toEqual([])
  })

  it('CONTROL: the same reader catches a check that passes everything, and one that refuses everything', () => {
    // Round 1, R1-TST-15: this control used to assert something no checker
    // could fail. It runs the test's own reader now.
    expect(disagreements(() => ({ ok: true }))).toHaveLength(REFUSED.length)
    expect(disagreements(() => ({ ok: false, error: 'x' }))).toHaveLength(ACCEPTED.length)
  })

  it('both PATCH routes run it BEFORE they merge the body', () => {
    const route = (sig) => {
      const at = mainCjs.indexOf(sig)
      expect(at, `no route ${sig}`).toBeGreaterThan(-1)
      return mainCjs.slice(at, mainCjs.indexOf('res.json(', at))
    }
    for (const sig of [
      "expressApp.patch('/api/rabbit/projects/:projectId/files/:id'",
      "expressApp.patch('/api/rabbit/projects/:projectId/managed-files/:id'",
    ]) {
      const body = route(sig)
      const check = body.indexOf('checkFileTags(patch)')
      const merge = body.search(/\.\.\.patch,/)
      expect(check, `${sig} does not check tags`).toBeGreaterThan(-1)
      expect(check, `${sig} merges before it checks`).toBeLessThan(merge)
      // The exact refusal, acting on the check's verdict (round 1, mutant 30:
      // `if (!tagCheck)` computed the check and let every tag through).
      expect(body).toContain("const tagCheck = checkFileTags(patch);")
      expect(body).toContain("if (!tagCheck.ok) return res.status(400).json({ error: tagCheck.error, code: 'bad_tags' });")
      expect(body.indexOf('if (!tagCheck.ok) return')).toBeLessThan(merge)
    }
    expect(mainCjs).toContain("const { checkFileTags } = require('./fileTags.cjs');")
  })
})
