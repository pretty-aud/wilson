// =============================================================================
// mothEligibility.test.js — MO1 (0111, MOTH_DESIGN §2.2 CL-2): the client's mirror
// of the classifier, arm by arm, and the migration's text held to the same arms.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { mothFileHidden } from './mothEligibility'

const PLAIN = { id: 'f1', storage_path: 'projects/p/files/f1/a.txt', tags: [], folder_id: null }
const FOLDERS = [
  { id: 'root', parent_id: null, kind: 'root', slug: 'Legal', path: '' },
  { id: 'scenes', parent_id: 'root', kind: 'category', slug: 'SCENES', path: 'SCENES' },
  { id: 'deep', parent_id: 'scenes', kind: 'custom', slug: 'Legal', path: 'SCENES/Legal' },
  { id: 'inv', parent_id: 'root', kind: 'category', slug: 'INVOICES', path: 'INVOICES' },
  { id: 'inv-x', parent_id: 'inv', kind: 'custom', slug: 'x', path: 'INVOICES/x' },
  { id: 'renamed', parent_id: 'root', kind: 'category', slug: 'finance', path: 'Old-name' },
  { id: 'renamed-y', parent_id: 'renamed', kind: 'custom', slug: 'y', path: 'Old-name/y' },
  { id: 'loop-a', parent_id: 'loop-b', kind: 'custom', slug: 'a', path: 'Loop' },
  { id: 'loop-b', parent_id: 'loop-a', kind: 'custom', slug: 'b', path: 'Loop/b' },
]

describe('mothFileHidden', () => {
  it('draws an ordinary row', () => {
    expect(mothFileHidden(PLAIN)).toBe(false)
    expect(mothFileHidden({ ...PLAIN, is_financial: false, tags: ['finance', 'production'] })).toBe(false)
  })

  it('fails closed on anything that is not a row', () => {
    for (const row of [null, undefined, 'f1', 7]) expect(mothFileHidden(row)).toBe(true)
  })

  it('hides the money flag', () => {
    expect(mothFileHidden({ ...PLAIN, is_financial: true })).toBe(true)
  })

  it.each(['INVOICES', 'FINANCE', 'LEGAL', 'legal'])('hides a %s key, by its third segment only', (seg) => {
    expect(mothFileHidden({ ...PLAIN, storage_path: `projects/p/${seg}/x/a.pdf` })).toBe(true)
    expect(mothFileHidden({ ...PLAIN, storage_path: `projects/p/files/${seg}/a.pdf` })).toBe(false)
  })

  it('hides the legal tag, whatever the key says', () => {
    expect(mothFileHidden({ ...PLAIN, tags: ['legal'] })).toBe(true)
  })

  it('hides a file this project\'s expense names', () => {
    expect(mothFileHidden(PLAIN, { expenseFileIds: ['f1'] })).toBe(true)
    expect(mothFileHidden(PLAIN, { expenseFileIds: new Set(['f1']) })).toBe(true)
    expect(mothFileHidden(PLAIN, { expenseFileIds: ['f2'] })).toBe(false)
  })

  it.each([
    ['a money top-level folder', 'inv', true],
    ['a folder under it', 'inv-x', true],
    ['a renamed category whose slug still says finance', 'renamed', true],
    ['a folder under that', 'renamed-y', true],
    ['a chain that loops, which fails closed', 'loop-b', true],
    ['a working folder called Legal, deep down', 'deep', false],
    ['a root whose project is called Legal', 'root', false],
    ['a folder this list does not hold', 'gone', false],
  ])('the folder chain: %s', (_what, folderId, hidden) => {
    expect(mothFileHidden({ ...PLAIN, folder_id: folderId }, { folders: FOLDERS })).toBe(hidden)
    expect(mothFileHidden({ ...PLAIN, folder_id: folderId }, { folders: new Map(FOLDERS.map((f) => [f.id, f])) })).toBe(hidden)
  })

  it('always returns: a loop through a root stops at 64 steps, as the walk does, and a root there locks nothing', () => {
    const selfRoot = [{ id: 'r', parent_id: 'r', kind: 'root', slug: 'p', path: '' }]
    expect(mothFileHidden({ ...PLAIN, folder_id: 'r' }, { folders: selfRoot })).toBe(false)
    const throughRoot = [
      { id: 'r', parent_id: 'a', kind: 'root', slug: 'p', path: '' },
      { id: 'a', parent_id: 'r', kind: 'custom', slug: 'a', path: 'Docs' },
    ]
    expect(mothFileHidden({ ...PLAIN, folder_id: 'a' }, { folders: throughRoot })).toBe(false)
    expect(mothFileHidden({ ...PLAIN, folder_id: 'r' }, { folders: throughRoot })).toBe(true)
  })

  it('stops at 64 steps, as the walk does: a deeper chain fails closed', () => {
    const chain = (n) => {
      const rows = [{ id: 'root', parent_id: null, kind: 'root', slug: 'r', path: '' }]
      for (let i = 1; i <= n; i += 1) {
        rows.push({ id: `n${i}`, parent_id: i === 1 ? 'root' : `n${i - 1}`, kind: 'custom', slug: `n${i}`, path: 'Top' })
      }
      return rows
    }
    expect(mothFileHidden({ ...PLAIN, folder_id: 'n63' }, { folders: chain(63) })).toBe(false)
    expect(mothFileHidden({ ...PLAIN, folder_id: 'n64' }, { folders: chain(64) })).toBe(true)
  })

  it('hides the desktop\'s old money folders, either slash, any case', () => {
    const dirs = ['film_RECEIPTS&INVOICES', 'film_CREWINVOICES', 'film_TALENTINVOICES']
    expect(mothFileHidden({ ...PLAIN, storage_path: 'film_RECEIPTS&INVOICES/a.pdf' }, { localMoneyDirs: dirs })).toBe(true)
    expect(mothFileHidden({ ...PLAIN, storage_path: 'x\\FILM_crewinvoices\\a.pdf' }, { localMoneyDirs: dirs })).toBe(true)
    expect(mothFileHidden({ ...PLAIN, storage_path: 'a.pdf' }, { localMoneyDirs: dirs })).toBe(false)
    expect(mothFileHidden({ ...PLAIN, storage_path: 'film_TALENTINVOICES-notes.pdf' }, { localMoneyDirs: dirs })).toBe(false)
  })
})

// The server's text, comments stripped: a change to an arm there goes red here,
// where the mirror above has to change with it.
describe('0111\'s classifier, read from the migration', () => {
  const migration = readFileSync(join(process.cwd(), 'supabase/migrations/0111_moth_read_path.sql'), 'utf8')
    .replace(/--[^\n]*/g, '')
  const body = (name) => {
    const start = migration.indexOf(`FUNCTION public.${name}(`)
    expect(start, `${name} is not in the migration`).toBeGreaterThan(-1)
    const open = migration.indexOf('$$', start)
    return migration.slice(open, migration.indexOf('$$', open + 2))
  }

  it('moth_file_row_locked has the four arms the mirror has', () => {
    const text = body('moth_file_row_locked')
    expect(text).toContain('public.file_row_is_money(p_flag, p_path)')
    expect(text).toContain("'legal' = ANY (p_tags)")
    expect(text).toContain('public.moth_folder_chain_locked(p_workspace, p_folder)')
    expect(text).toContain('e.file_ids @> ARRAY[p_file]')
    // Scoped to the row's own project: an expense elsewhere hides nothing.
    expect(text).toContain('e.project_id = p_project')
    // A row image: history's capture of a deleted row has no live row to read.
    expect(text).not.toContain('public.files')
  })

  it('moth_folder_chain_locked has the arms moneyFolderChainLocked has', () => {
    const text = body('moth_folder_chain_locked')
    expect(text).toContain("n.kind <> 'root'")
    expect(text).toContain("public.rabbit_money_segment(split_part(n.path, '/', 1))")
    expect(text).toContain('public.rabbit_money_segment(n.slug)')
    expect(text).toContain("r.id = n.parent_id AND r.kind = 'root'")
    expect(text).toContain('up.depth < 64')
    expect(text).toContain('n.depth = 64')
  })

  it('the gate calls the classifiers and has no admin leg on a personal space', () => {
    const text = latestBody('_moth_target_eligible')
    expect(text).toContain('public.moth_file_row_locked(')
    expect(text).toContain('public.moth_folder_chain_locked(')
    expect(text).toContain('public.passes_project_privacy(p.id)')
    expect(text).toContain('p.personal_owner_id IS NULL OR p.personal_owner_id = auth.uid()')
    expect(text).not.toContain('current_app_role')
    expect(text).not.toContain('can_access_project_money')
  })

  // MO2 (0122): the seven kinds of item, each its project's, each in this company, the trash keeping three out.
  it("the latest gate is 0122's, and each item kind is its project's, in this company, out of the trash", () => {
    expect(latestFile('_moth_target_eligible')).toBe('0122_moth_graph_reads.sql')
    const text = latestBody('_moth_target_eligible')
    for (const kind of ['phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience']) expect(text).toContain(`p_kind = '${kind}'`)
    for (const arm of ['a.workspace_id = v_ws', 't.workspace_id = v_ws', 's.workspace_id = v_ws', 'sh.workspace_id = v_ws',
      'l.workspace_id = v_ws', 'e.workspace_id = v_ws']) expect(text).toContain(arm)
    expect(text.match(/v_deleted IS NOT NULL AND NOT COALESCE\(p_allow_trashed, false\)/g)).toHaveLength(4)
    expect(text).toContain('p.workspace_id = v_ws')
  })
})

// The newest migration that defines a function, and that body (comments stripped): what the database runs.
function latestFile(name) {
  const dir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
  return files.filter((f) => readFileSync(join(dir, f), 'utf8').includes(`FUNCTION public.${name}(`)).pop()
}
function latestBody(name) {
  const text = readFileSync(join(process.cwd(), 'supabase/migrations', latestFile(name)), 'utf8').replace(/--[^\n]*/g, '')
  const start = text.lastIndexOf(`FUNCTION public.${name}(`)
  const open = text.indexOf('$$', start)
  return text.slice(open, text.indexOf('$$', open + 2))
}
