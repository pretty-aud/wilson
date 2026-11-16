// =============================================================================
// legalSurfaces.test.js — post-overhaul S4b (0088): every place a file row
// can travel on the CLIENT, and that a Legal file does not travel there.
//
// Audrey, 2026-10-01: a Legal file is seen by "same as money files for now".
// The database withholds a Legal row from a member or reviewer (0088's row
// policies; suite 90). A MANAGER's client does receive it — so every surface
// that hands rows on to something the whole project reads must leave it out:
//
//   * D.O.G.'s deck attachments (a deck is shared)      deckAttachments.js
//   * the Projects page's Project Files table — since review round 2 it
//     LISTS a Legal file (the one page where a file is deleted), its Core
//     locked                                           ProjectsPage.jsx,
//                                                      ProjectFilesTable.jsx
//   * the entity file managers (an asset's files)       FileManager.jsx
//   * Core itself (Intake and D.O.G. read core files)   RabbitProvider.jsx
//   * the pet: its context reads NO file row at all     App.jsx, petKnowledge.js
//
// The first is tested by behaviour in deckAttachmentSource.test.js; the two
// list filters and the pet are pinned here by their source (they are deep in
// components no test mounts), each with a planted control that proves the pin
// can fail. Core's refusal is driven through the real provider in
// fileVerbsProvider.test.jsx.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, p), 'utf8').replace(/\r\n/g, '\n')

const PROJECTS_PAGE = read('../../components/Projects/ProjectsPage.jsx')
const FILE_MANAGER = read('./components/FileManager.jsx')
const APP = read('../../App.jsx')
const PET = read('../otter_v0.3.1/petKnowledge.js')

// CODE, not comments: a filter moved into a comment, with a live line that
// forgot Legal, read as the comment (review round 1, R1-BEH-12 — planted
// fault R1-8 survived). Comment lines are dropped first, and a reader that
// finds the line more than once answers null rather than pick one.
// Block comments too (review round 2's re-check, R3-4: a /* … */ around the
// Projects page's Core refusal still matched its pin).
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
const only = (re, src) => {
  const all = [...code(src).matchAll(re)]
  return all.length === 1 ? all[0][1] : null
}
/** The Projects page's one listFiles filter, as written. */
const projectsFilter = (src) => only(/setFileRows\(\(rows \|\| \[\]\)\.filter\(([^\n]*)\)\)/g, src)
/** FileManager's money exclusion line. */
const managerFilter = (src) => only(/\n\s*if \((f\.is_financial[^\n]*?)\) return false/g, src)

describe('the Projects page lists a Legal file (Core locked); the entity file managers leave it out', () => {
  // Review round 2 (found while writing the walkthrough): filtering Legal
  // files out of the Projects page left a manager no way to DELETE one — the
  // file window has no Delete, and "add it again" is how Legal is changed.
  // The database already gives the row only to the people who may see it.
  it('the Projects page keeps invoices out and Legal files IN, and refuses Core on one', () => {
    expect(projectsFilter(PROJECTS_PAGE)).toBe('f => !f.deleted_at && !f.is_financial')
    expect(code(PROJECTS_PAGE)).toMatch(/if \(storedRow && patch\?\.is_core_definer && isLegalFile\(storedRow\)\) \{\s*setSaveError\(LEGAL_NOT_CORE_REASON\)\s*return/)
    expect(PROJECTS_PAGE).toContain("import { isLegalFile, LEGAL_NOT_CORE_REASON } from '../../tools/rabbit_v0.1.0/fileTags'")
  })

  it('an entity file manager does the same', () => {
    expect(managerFilter(FILE_MANAGER)).toBe('f.is_financial || isLegalFile(f)')
    expect(FILE_MANAGER).toContain("import { isLegalFile } from '../fileTags'")
  })

  it('CONTROL: the readers see a filter that changed', () => {
    const forgot = PROJECTS_PAGE.replace(' && !f.is_financial))', '))')
    expect(projectsFilter(forgot)).not.toBe(projectsFilter(PROJECTS_PAGE))
    const forgotToo = FILE_MANAGER.replace(' || isLegalFile(f)', '')
    expect(managerFilter(forgotToo)).toBe('f.is_financial')
  })

  it('CONTROL: …and are not fooled by the right filter in a comment above a wrong one (planted fault R1-8)', () => {
    const line = 'setFileRows((rows || []).filter(f => !f.deleted_at && !f.is_financial))'
    const at = PROJECTS_PAGE.indexOf(line)
    expect(at).toBeGreaterThan(-1)
    const commented = PROJECTS_PAGE.slice(0, at) + '// ' + line + '\n      '
      + 'setFileRows((rows || []).filter(f => !f.deleted_at))' + PROJECTS_PAGE.slice(at + line.length)
    expect(projectsFilter(commented)).toBe('f => !f.deleted_at')
  })
})

describe('the pet never reads a file row (I5)', () => {
  // sendChat's context is the page, a fixed RABBIT block, the pet's own state
  // and O.T.T.E.R. course excerpts (petKnowledge). None of them is a project
  // file. If that ever changes, this is where a Legal file would start to
  // reach a chat — so the absence is pinned.
  const sendChat = (() => {
    const at = APP.indexOf('const sendChat = useCallback(')
    return at === -1 ? '' : APP.slice(at, APP.indexOf('\n  }, [', at))
  })()

  it('sendChat builds its context without a files read', () => {
    expect(sendChat.length).toBeGreaterThan(1000)
    expect(sendChat).toContain('RABBIT KNOWLEDGE')
    expect(sendChat).not.toMatch(/listFiles|\.files\b|from\('files'\)|storage_path|getAdapter/)
  })

  it('petKnowledge reads courses and lessons, never files', () => {
    expect(PET).toContain('export function buildKnowledgeBlock')
    expect(PET).not.toMatch(/listFiles|from\('files'\)|storage_path|rabbit_v0\.1\.0/)
  })

  it('CONTROL: the same pin sees a files read slipped into sendChat', () => {
    const slipped = sendChat.replace('RABBIT KNOWLEDGE', 'RABBIT KNOWLEDGE ${await adapter.listFiles(id)}')
    expect(slipped).toMatch(/listFiles/)
  })
})
