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
  LEGAL_LOCKED_REASON, LEGAL_AT_ADD_REASON, LEGAL_NOT_CORE_REASON,
  tagLabel, storedTags, displayTags, writableTags, toggleTag, tagSettable, tagsMatch, isLegalFile, legalRefusalSentence,
} from './fileTags'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const cjs = require(resolve(here, '../../../electron/fileTags.cjs'))
const migration = readFileSync(resolve(here, '../../../supabase/migrations/0085_file_tags.sql'), 'utf8')
const mainCjs = readFileSync(resolve(here, '../../../electron/main.cjs'), 'utf8').replace(/\r\n/g, '\n')
const patchCjs = readFileSync(resolve(here, '../../../electron/projectFilePatch.cjs'), 'utf8').replace(/\r\n/g, '\n')

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
    // The hint is the truth now, not "not restricted yet" — and since 0092
    // (S4d) the truth names workspace managers too.
    expect(LEGAL_HINT).toBe('Only project managers, workspace managers and workspace admins can see this file.')
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

  it('isLegalFile on a CLOUD key is the folder alone: an S4a label there is not Legal (review round 1, R1-BEH-03)', () => {
    expect(isLegalFile({ storage_provider: 'supabase', storage_path: 'projects/p/project/p/1-a.pdf', tags: ['legal', 'code'] })).toBe(false)
    expect(isLegalFile({ storage_provider: 's3', storage_path: 'projects/p/scenes/s/1-a.pdf', tags: ['legal'] })).toBe(false)
    expect(isLegalFile({ storage_provider: 'supabase', storage_path: 'projects/p/LEGAL/p/1-a.pdf', tags: [] })).toBe(true)
  })

  it('isLegalFile on a private project\'s cloud row (provider local_server, a projects/{uuid}/ key) is the folder too (R2-BEH-04)', () => {
    const pid = '3f9b6a52-1c0e-4d7a-9a51-2b8c7d6e5f40'
    expect(isLegalFile({ storage_provider: 'local_server', storage_path: `projects/${pid}/project/${pid}/1-a.pdf`, tags: ['legal'] })).toBe(false)
    expect(isLegalFile({ storage_provider: 'local_server', storage_path: `projects/${pid}/LEGAL/${pid}/1-a.pdf`, tags: [] })).toBe(true)
    // and toggleTag clears the label on such a row
    expect(toggleTag({ storage_provider: 'local_server', storage_path: `projects/${pid}/project/${pid}/1-a.pdf`, tags: ['legal'] }, 'code')).toEqual(['code'])
  })

  it('isLegalFile on a LOCAL SERVER row is the tag alone: a folder of the person\'s own called Legal is not (R1-BEH-06)', () => {
    expect(isLegalFile({ storage_provider: 'local_server', storage_path: 'Docs/2026/Legal/nda.pdf' })).toBe(false)
    expect(isLegalFile({ storage_provider: 'local_server', storage_path: 'projects/x/LEGAL/y/nda.pdf' })).toBe(false)
    expect(isLegalFile({ storage_provider: 'local_server', storage_path: 'f1-nda.pdf', tags: ['legal'] })).toBe(true)
  })

  it('toggleTag drops a stray Legal label from the write, and a managed file never keeps one', () => {
    // A cloud row labelled in S4a: the next save clears the label.
    expect(toggleTag({ storage_provider: 'supabase', storage_path: 'projects/p/project/p/1.pdf', tags: ['legal', 'code'] }, 'shots'))
      .toEqual(['code', 'shots'])
    // The file window says a managed file is not Legal, whatever it carries.
    expect(toggleTag({ tags: ['legal', 'shots'] }, 'code', { legal: false })).toEqual(['code', 'shots'])
    // CONTROL: a Legal file keeps it.
    expect(toggleTag({ storage_provider: 'supabase', storage_path: 'projects/p/LEGAL/p/1.pdf', tags: ['legal'] }, 'code'))
      .toEqual(['legal', 'code'])
  })

  it('legalRefusalSentence: each 0088 refusal in the words the person needs (R1-BEH-08)', () => {
    const folder = 'new row for relation "files" violates check constraint "files_legal_folder_chk"'
    expect(legalRefusalSentence(folder, { tags: ['legal', 'code'] })).toBe(LEGAL_AT_ADD_REASON)
    expect(legalRefusalSentence(folder, { tags: ['code'] })).toBe(LEGAL_LOCKED_REASON)
    expect(legalRefusalSentence(folder, { description: 'x' })).toBe(LEGAL_LOCKED_REASON)
    expect(legalRefusalSentence('files_legal_fixed: a file is Legal from the moment it is added', {})).toBe(LEGAL_LOCKED_REASON)
    expect(legalRefusalSentence('violates check constraint "files_legal_not_core_chk"', { is_core_definer: true })).toBe(LEGAL_NOT_CORE_REASON)
    expect(legalRefusalSentence('permission denied', { tags: ['legal'] })).toBe(null)
    expect(legalRefusalSentence(undefined)).toBe(null)
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
    // Since S4b the two routes live in projectFilePatch.cjs (served for real
    // in storage/projectFilePatch.test.js); main.cjs mounts it where the
    // files PATCH stood, with the real checks.
    const route = (sig) => {
      const at = patchCjs.indexOf(sig)
      expect(at, `no route ${sig}`).toBeGreaterThan(-1)
      return patchCjs.slice(at, patchCjs.indexOf('res.json(', at))
    }
    for (const sig of [
      'expressApp.patch(FILES_PATCH,',
      'expressApp.patch(MANAGED_PATCH,',
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
      // S4b: the Legal check, acting on its verdict, also before the merge.
      expect(body).toMatch(/if \(!legalCheck\.ok\) return res\.status\(400\)\.json\(\{ error: legalCheck\.error, code: legalCheck\.code \}\);/)
      expect(body.indexOf('if (!legalCheck.ok) return')).toBeLessThan(merge)
    }
    expect(patchCjs).toContain("const FILES_PATCH = '/api/rabbit/projects/:projectId/files/:id';")
    expect(patchCjs).toContain("const MANAGED_PATCH = '/api/rabbit/projects/:projectId/managed-files/:id';")
    expect(mainCjs).toContain("const { checkFileTags, checkLegalPatch, checkManagedLegal, isLegalRow, LEGAL_DIR } = require('./fileTags.cjs');")
    expect(mainCjs).toContain("require('./projectFilePatch.cjs').mountProjectFilePatch(expressApp, {")
    expect(mainCjs).toContain('checkFileTags, checkLegalPatch, checkManagedLegal,')
    // The routes are not ALSO still defined in main.cjs (two would race).
    expect(mainCjs).not.toContain("expressApp.patch('/api/rabbit/projects/:projectId/files/:id'")
    expect(mainCjs).not.toContain("expressApp.patch('/api/rabbit/projects/:projectId/managed-files/:id'")
  })
})

describe('the Local Server files Legal files as the cloud does (S4b, 0088)', () => {
  it('the desktop\'s sentences are the client\'s, word for word', () => {
    expect(cjs.LEGAL_LOCKED_REASON).toBe(LEGAL_LOCKED_REASON)
    expect(cjs.LEGAL_AT_ADD_REASON).toBe(LEGAL_AT_ADD_REASON)
    expect(cjs.LEGAL_NOT_CORE_REASON).toBe(LEGAL_NOT_CORE_REASON)
    expect(cjs.LEGAL_TAG).toBe(GATED_TAG)
    expect(cjs.LEGAL_DIR).toBe(LEGAL_SEGMENT)
  })

  it('checkLegalPatch: the tag never moves, a Legal file is never core; everything else passes', () => {
    const plain = { tags: ['code'] }
    const legal = { tags: ['legal'] }
    expect(cjs.checkLegalPatch(plain, { tags: ['legal'] })).toMatchObject({ ok: false, code: 'legal_fixed' })
    expect(cjs.checkLegalPatch(legal, { tags: [] })).toMatchObject({ ok: false, code: 'legal_fixed' })
    expect(cjs.checkLegalPatch(legal, { is_core_definer: true })).toMatchObject({ ok: false, code: 'legal_not_core' })
    expect(cjs.checkLegalPatch(legal, { tags: ['legal', 'shots'], is_core_definer: false })).toEqual({ ok: true })
    expect(cjs.checkLegalPatch(plain, { tags: ['shots'], is_core_definer: true })).toEqual({ ok: true })
    expect(cjs.checkLegalPatch(plain, { description: 'x' })).toEqual({ ok: true })
    expect(cjs.checkManagedLegal({ tags: ['legal'] })).toMatchObject({ ok: false, code: 'bad_tags' })
    expect(cjs.checkManagedLegal({ tags: ['shots'] })).toEqual({ ok: true })
  })

  it('main.cjs: a LEGAL folder beside INVOICES, and every Legal decision handed to legalFiling.cjs', () => {
    // CODE, not comments: a line commented out must not satisfy a pin
    // (review round 1, R1-1 and R1-5 survived on exactly that) — nor one in a
    // block comment (round 2, R2-11 and R2-12 survived on that).
    const code = mainCjs.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    // Made with the project, beside INVOICES (so a NAS can lock it).
    const dirs = code.slice(code.indexOf('function ensureProjectFolders(bundle)'), code.indexOf('for (const d of dirs)'))
    expect(dirs).toContain("path.join(root, 'INVOICES'),")
    expect(dirs).toContain('path.join(root, LEGAL_DIR),')
    // The module is created with the host's helpers, before the first bundle read.
    expect(code).toMatch(/const legalFiling = require\('\.\/legalFiling\.cjs'\)\.createLegalFiling\(\{\s*fs, path, resolveProjectFolder, resolveProjectFilesDir, getRabbitProjectDir, resolveContainedFilePath,\s*\}\);/)
    expect(code.indexOf('const legalFiling = ')).toBeLessThan(code.indexOf('function readRabbitBundle('))
    // S4a-period labels are settled ONCE per project, recorded, persisted
    // (review round 2, R2-BEH-01: every read could strip a real Legal file).
    const read = code.slice(code.indexOf('function readRabbitBundle('), code.indexOf('function writeRabbitBundle('))
    expect(read).toMatch(/if \(!bundle\.legalLabelsSettled\) \{\s*try \{\s*const settled = legalFiling\.settleLegalLabels\(bundle, projectId\);/)
    // What was stripped is persisted at once; the marker only once settled.
    expect(read).toMatch(/if \(settled\.stripped\.length > 0\) \{\s*bundle\.legalLabelsStripped = \[\.\.\.\(bundle\.legalLabelsStripped \|\| \[\]\), \.\.\.settled\.stripped\];\s*dirty = true;/)
    expect(read).toMatch(/if \(settled\.settled\) \{\s*bundle\.legalLabelsSettled = \{ at: new Date\(\)\.toISOString\(\), stripped: bundle\.legalLabelsStripped \|\| \[\] \};\s*dirty = true;/)
    expect(read).not.toContain('stripStrayLegal')
    // A Legal body is written to, and read from, a LEGAL folder — never the files dir.
    const legalDirFn = code.slice(code.indexOf('function resolveProjectLegalDir('), code.indexOf('function resolveFileBaseDir('))
    expect(legalDirFn).toContain('return legalFiling.legalDir(bundle, projectId);')
    expect(legalDirFn).not.toContain('resolveProjectFilesDir')
    const base = code.slice(code.indexOf('function resolveFileBaseDir('), code.indexOf('function isUserAuthorizedRelinkDir('))
    expect(base.indexOf('if (isLegalRow(file)) return legalFiling.baseDirFor(bundle, projectId, file);')).toBeGreaterThan(-1)
    expect(base.indexOf('if (isLegalRow(file)) return legalFiling.baseDirFor(bundle, projectId, file);'))
      .toBeLessThan(base.indexOf('if (!file?.is_financial) return filesDir;'))
    // The relink scan leaves invoices and Legal files out; the apply refuses them.
    const scan = code.slice(code.indexOf("'/api/rabbit/projects/:projectId/files/relink-scan'"))
    expect(scan.slice(0, scan.indexOf('const { folderPath }'))).toContain('if (!legalFiling.relinkable(f)) continue;')
    const apply = code.slice(code.indexOf("'/api/rabbit/projects/:projectId/files/relink-apply'"))
    expect(apply.slice(0, apply.indexOf('if (changingBase)'))).toMatch(/if \(!legalFiling\.relinkable\(file\)\) \{\s*return res\.status\(400\)/)
    // The base64 POST lives beside the stream now (projectFileStream.test.js
    // serves both for real); main.cjs registers it nowhere, in any quotes
    // (round 2, R2-10: a second registration would shadow the module's).
    expect(code).not.toMatch(/\.post\(\s*['"`]\/api\/rabbit\/projects\/:projectId\/files['"`]/)
    // The stream module is handed the LEGAL resolver.
    expect(code).toContain('resolveProjectFilesDir, resolveProjectInvoicesDir, resolveProjectLegalDir, uuidv4,')
  })
})
