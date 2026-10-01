// =============================================================================
// legalFiling.test.js — where the Local Server keeps a Legal file
// (electron/legalFiling.cjs), run for real against a temp directory with the
// real containment guard (post-overhaul S4b, review round 1: R1-BEH-03, 04,
// 05 and 10 — the desktop's Legal filing had been pinned as source text
// only, and six planted faults in it survived).
//
// What this pins:
//   * a new Legal body goes to <project folder>/LEGAL, or with no project
//     folder to the internal project dir's LEGAL — NEVER the files dir;
//   * a Legal row is read from a LEGAL folder first (the project's, then the
//     internal one), then from wherever its body actually is;
//   * S4a-period `legal` labels are stripped on read: a managed file's, an
//     invoice's, a project file's whose body is in the files dir — while a
//     real Legal file (body in LEGAL) and a Legal row whose body is missing
//     keep the tag;
//   * relink never takes an invoice or a Legal file.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createLegalFiling } = require('../../../../electron/legalFiling.cjs')
const { resolveContainedFilePath } = require('../../../../electron/pathContainment.cjs')

let tmp, projectRoot, internalRoot, filesDir, hasFolder

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-legal-filing-'))
  projectRoot = path.join(tmp, 'Projects', 'Salt-Hours')
  internalRoot = path.join(tmp, 'rabbit-data', 'projects')
  filesDir = path.join(projectRoot, 'Salt-Hours_FILES')
  fs.mkdirSync(filesDir, { recursive: true })
  hasFolder = true
})
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

const filing = () => createLegalFiling({
  fs,
  path,
  resolveProjectFolder: () => (hasFolder ? projectRoot : null),
  // With no project folder the files dir is the internal one (main.cjs's
  // getRabbitFilesDir), which is where an invoice would fall back to.
  resolveProjectFilesDir: (_b, pid) => {
    const dir = hasFolder ? filesDir : path.join(internalRoot, pid, 'files')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  },
  getRabbitProjectDir: (pid) => path.join(internalRoot, pid),
  resolveContainedFilePath,
})
const PID = 'p-legal'
const bundle = (over = {}) => ({ project: { id: PID, title: 'Salt Hours' }, files: [], managedFiles: [], ...over })
const write = (dir, name, text = 'x') => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text) }

describe('legalDir — where a new Legal body is written', () => {
  it('is <project folder>/LEGAL, made if missing', () => {
    const dir = filing().legalDir(bundle(), PID)
    expect(dir).toBe(path.join(projectRoot, 'LEGAL'))
    expect(fs.existsSync(dir)).toBe(true)
  })

  it('with NO project folder, the internal project dir\'s LEGAL — never the files dir (R1-BEH-04)', () => {
    hasFolder = false
    const f = filing()
    const dir = f.legalDir(bundle(), PID)
    expect(dir).toBe(path.join(internalRoot, PID, 'LEGAL'))
    expect(fs.existsSync(dir)).toBe(true)
    expect(dir).not.toBe(path.join(internalRoot, PID, 'files'))
  })

  it('requires every helper', () => {
    expect(() => createLegalFiling({ fs, path })).toThrow(/required/)
  })
})

describe('baseDirFor — where a Legal row is read from', () => {
  const row = { id: 'f1', storage_path: 'f1-nda.pdf', tags: ['legal'] }

  it('the project\'s LEGAL when the body is there', () => {
    write(path.join(projectRoot, 'LEGAL'), row.storage_path)
    expect(filing().baseDirFor(bundle(), PID, row)).toBe(path.join(projectRoot, 'LEGAL'))
  })

  it('the internal LEGAL for a body added before the project had a folder', () => {
    write(path.join(internalRoot, PID, 'LEGAL'), row.storage_path)
    expect(filing().baseDirFor(bundle(), PID, row)).toBe(path.join(internalRoot, PID, 'LEGAL'))
  })

  it('the project\'s LEGAL wins over the internal one when both hold it', () => {
    write(path.join(internalRoot, PID, 'LEGAL'), row.storage_path)
    write(path.join(projectRoot, 'LEGAL'), row.storage_path)
    expect(filing().baseDirFor(bundle(), PID, row)).toBe(path.join(projectRoot, 'LEGAL'))
  })

  it('the files dir only when the body is there and in no LEGAL folder', () => {
    write(filesDir, row.storage_path)
    expect(filing().baseDirFor(bundle(), PID, row)).toBe(filesDir)
  })

  it('nowhere: the canonical LEGAL, so a 410 names where it belongs', () => {
    expect(filing().baseDirFor(bundle(), PID, row)).toBe(path.join(projectRoot, 'LEGAL'))
  })

  it('a storage_path that walks out is never found (the containment guard)', () => {
    write(tmp, 'outside.pdf')
    const evil = { ...row, storage_path: '../../../outside.pdf' }
    expect(filing().baseDirFor(bundle(), PID, evil)).toBe(path.join(projectRoot, 'LEGAL'))
  })
})

describe('settleLegalLabels — S4a\'s labels, removed ONCE (R1-BEH-03; review round 2, R2-BEH-01)', () => {
  const settle = (b) => filing().settleLegalLabels(b, PID)

  it('a real Legal file (body in LEGAL) keeps its tag; nothing changes', () => {
    const f = { id: 'a', storage_path: 'a.pdf', tags: ['legal', 'production'] }
    write(path.join(projectRoot, 'LEGAL'), f.storage_path)
    const b = bundle({ files: [f] })
    expect(settle(b)).toEqual({ settled: true, stripped: [] })
    expect(b.files[0].tags).toEqual(['legal', 'production'])
  })

  it('…even with a same-name copy in the files dir: LEGAL decides (planted fault R2-1)', () => {
    const f = { id: 'a2', storage_path: 'a2.pdf', tags: ['legal'] }
    write(path.join(projectRoot, 'LEGAL'), f.storage_path)
    write(filesDir, f.storage_path)
    const b = bundle({ files: [f] })
    expect(settle(b).stripped).toEqual([])
    expect(b.files[0].tags).toEqual(['legal'])
  })

  it('…and in the internal LEGAL (added while the project had no folder)', () => {
    const f = { id: 'a3', storage_path: 'a3.pdf', tags: ['legal'] }
    write(path.join(internalRoot, PID, 'LEGAL'), f.storage_path)
    write(filesDir, f.storage_path)
    const b = bundle({ files: [f] })
    expect(settle(b).stripped).toEqual([])
  })

  it('a project file labelled Legal whose body is in the files dir loses the label, and only it', () => {
    const f = { id: 'b', storage_path: 'b.pdf', tags: ['legal', 'creative'] }
    write(filesDir, f.storage_path)
    const b = bundle({ files: [f] })
    expect(settle(b)).toEqual({ settled: true, stripped: ['b'] })
    expect(b.files[0].tags).toEqual(['creative'])
  })

  it('an invoice is never Legal: its label goes wherever the body is', () => {
    const f = { id: 'c', storage_path: 'c.pdf', tags: ['legal'], is_financial: true }
    const b = bundle({ files: [f] })
    expect(settle(b).stripped).toEqual(['c'])
    expect(b.files[0].tags).toEqual([])
  })

  it('a managed file (an asset\'s, a shot\'s, a scene\'s) is never Legal', () => {
    const m = { id: 'm', file_name: 'take.mov', tags: ['shots', 'legal'] }
    const b = bundle({ managedFiles: [m] })
    expect(settle(b).stripped).toEqual(['m'])
    expect(b.managedFiles[0].tags).toEqual(['shots'])
  })

  it('a Legal row whose body is missing everywhere stays Legal (fail closed)', () => {
    const f = { id: 'd', storage_path: 'gone.pdf', tags: ['legal'] }
    const b = bundle({ files: [f] })
    expect(settle(b)).toEqual({ settled: true, stripped: [] })
    expect(b.files[0].tags).toEqual(['legal'])
  })

  it('NOT settled, nothing touched, while the project\'s folder is configured but unreachable (a NAS offline)', () => {
    hasFolder = false
    const f = { id: 'n', storage_path: 'n.pdf', tags: ['legal'] }
    // A relinked local copy in the fallback files dir: the round-2 scenario.
    write(path.join(internalRoot, PID, 'files'), f.storage_path)
    const b = bundle({ project: { id: PID, title: 'Salt Hours', folder_root: 'Z:\\nas\\Salt-Hours' }, files: [f] })
    expect(settle(b)).toEqual({ settled: false, stripped: [] })
    expect(b.files[0].tags).toEqual(['legal'])
  })

  it('CONTROL: a project with NO folder configured is settled (its LEGAL is the internal one)', () => {
    hasFolder = false
    const f = { id: 'o', storage_path: 'o.pdf', tags: ['legal'] }
    write(path.join(internalRoot, PID, 'LEGAL'), f.storage_path)
    const b = bundle({ files: [f] })
    expect(settle(b)).toEqual({ settled: true, stripped: [] })
  })

  it('CONTROL: untagged rows and rows without tags are left alone', () => {
    const b = bundle({ files: [{ id: 'e', storage_path: 'e.pdf', tags: ['creative'] }, { id: 'f', storage_path: 'f.pdf' }], managedFiles: [{ id: 'g' }] })
    expect(settle(b)).toEqual({ settled: true, stripped: [] })
    expect(b.files[0].tags).toEqual(['creative'])
    expect(b.files[1].tags).toBeUndefined()
  })

  it('resolves the folders once per call, not once per row (R2-BEH-03)', () => {
    let roots = 0
    const counted = createLegalFiling({
      fs, path,
      resolveProjectFolder: () => { roots += 1; return projectRoot },
      resolveProjectFilesDir: () => filesDir,
      getRabbitProjectDir: (pid) => path.join(internalRoot, pid),
      resolveContainedFilePath,
    })
    const files = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, storage_path: `r${i}.pdf`, tags: ['legal'] }))
    counted.settleLegalLabels(bundle({ files }), PID)
    expect(roots).toBeLessThanOrEqual(2)
  })
})

describe('relinkable — the relink flow\'s rows (R1-BEH-10)', () => {
  it('an ordinary file yes; an invoice and a Legal file never', () => {
    const f = filing()
    expect(f.relinkable({ id: 'a', storage_path: 'a.pdf' })).toBe(true)
    expect(f.relinkable({ id: 'a', storage_path: 'a.pdf', tags: ['creative'] })).toBe(true)
    expect(f.relinkable({ id: 'b', is_financial: true })).toBe(false)
    expect(f.relinkable({ id: 'c', tags: ['legal'] })).toBe(false)
  })
})
