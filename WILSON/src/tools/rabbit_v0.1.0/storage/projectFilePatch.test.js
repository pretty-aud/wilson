// =============================================================================
// projectFilePatch.test.js — the Local Server's two file PATCH routes
// (electron/projectFilePatch.cjs, lifted out of main.cjs by post-overhaul
// S4b), served for real: an express app on an ephemeral port with main.cjs's
// global json parser, the real fileTags.cjs checks, and a bundle store with
// disk semantics (read = parse a copy, write = store) — the
// rabbitBins.routes.test.js pattern.
//
// What this pins, for 0088's parity on the desktop (Audrey, 2026-10-01:
// "its just the folder that is locked"):
//   * a files row's legal tag is never added or removed after upload, and a
//     Legal file never becomes core — each refused 400 with its code, and the
//     bundle untouched (a refusal writes nothing);
//   * a managed file is never Legal;
//   * S4a's tag refusals and S14/S17's path-field strips still hold, and an
//     ordinary edit still saves (the CONTROLS);
//   * MO1 (0114, MOTH §1 and §2.1): where a file is kept and filed is not a patch.
//     Another project's id is 409, a folder change 400, and the rest are dropped,
//     as the cloud's guard refuses them; the adapter's own project_id still passes.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountProjectFilePatch } = require('../../../../electron/projectFilePatch.cjs')
const tags = require('../../../../electron/fileTags.cjs')

const PID = 'p-patch-1'
const store = new Map()
let writes = 0
const readRabbitBundle = (id) => (store.has(id) ? JSON.parse(store.get(id)) : null)
const writeRabbitBundle = (id, bundle) => { writes += 1; store.set(id, JSON.stringify(bundle)) }
const rabbitNotFound = (res, what = 'project') => res.status(404).json({ error: `${what} not found` })

function seed() {
  store.set(PID, JSON.stringify({
    project: { id: PID, title: 'Patch' },
    files: [
      { id: 'plain', name: 'brief.pdf', storage_path: 'x-brief.pdf', tags: ['creative'], is_core_definer: false },
      { id: 'legal', name: 'release.pdf', storage_path: 'y-release.pdf', tags: ['legal'], is_core_definer: false },
      { id: 'filed', project_id: PID, name: 'inv.pdf', storage_path: 'z-inv.pdf', folder_id: 'fd-invoices', is_financial: true, tags: [], is_core_definer: false },
    ],
    managedFiles: [{ id: 'm1', file_name: 'take.mov', folder_path: 'ASSETS/hero/', stored_name: 'take.mov', tags: [] }],
  }))
  writes = 0
}

let server, base
beforeAll(async () => {
  const app = express()
  app.use(express.json({ limit: '50mb' }))
  mountProjectFilePatch(app, {
    readRabbitBundle, writeRabbitBundle, rabbitNotFound,
    checkFileTags: tags.checkFileTags, checkLegalPatch: tags.checkLegalPatch, checkManagedLegal: tags.checkManagedLegal,
  })
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/rabbit/projects/${PID}`
})
afterAll(async () => { await new Promise((r) => server.close(r)) })
beforeEach(seed)

const patch = (p, body) => fetch(`${base}${p}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const file = (id) => readRabbitBundle(PID).files.find(f => f.id === id)

describe('PATCH …/files/:id — Legal is a fact (S4b)', () => {
  it('ticking Legal on an ordinary file: 400 legal_fixed, nothing written', async () => {
    const r = await patch('/files/plain', { tags: ['creative', 'legal'] })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: tags.LEGAL_AT_ADD_REASON, code: 'legal_fixed' })
    expect(file('plain').tags).toEqual(['creative'])
    expect(writes).toBe(0)
  })

  it('un-tagging a Legal file: 400 legal_fixed with "Added as Legal…", nothing written', async () => {
    const r = await patch('/files/legal', { tags: ['production'] })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: tags.LEGAL_LOCKED_REASON, code: 'legal_fixed' })
    expect(file('legal').tags).toEqual(['legal'])
    expect(writes).toBe(0)
  })

  it('a Legal file made core: 400 legal_not_core, nothing written', async () => {
    const r = await patch('/files/legal', { is_core_definer: true })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('legal_not_core')
    expect(file('legal').is_core_definer).toBe(false)
    expect(writes).toBe(0)
  })

  it('CONTROLS: other tags beside legal, a note, Core OFF on a Legal file, and Core on an ordinary one all save', async () => {
    expect((await patch('/files/legal', { tags: ['legal', 'production'] })).status).toBe(200)
    expect(file('legal').tags).toEqual(['legal', 'production'])
    expect((await patch('/files/legal', { description: 'countersigned', is_core_definer: false })).status).toBe(200)
    expect(file('legal').description).toBe('countersigned')
    expect((await patch('/files/plain', { is_core_definer: true, tags: ['creative', 'shots'] })).status).toBe(200)
    expect(file('plain')).toMatchObject({ is_core_definer: true, tags: ['creative', 'shots'] })
    expect(writes).toBe(3)
  })

  it('S4a still holds: an unknown tag is 400 bad_tags; S14 still strips the path fields', async () => {
    const bad = await patch('/files/plain', { tags: ['notes'] })
    expect(bad.status).toBe(400)
    expect((await bad.json()).code).toBe('bad_tags')
    const ok = await patch('/files/plain', { storage_path: '../../etc/passwd', storage_provider: 's3', name: 'renamed.pdf' })
    expect(ok.status).toBe(200)
    expect(file('plain')).toMatchObject({ storage_path: 'x-brief.pdf', name: 'renamed.pdf' })
    expect(file('plain').storage_provider).toBeUndefined()
  })

  it('an unknown file is 404', async () => {
    expect((await patch('/files/nope', { description: 'x' })).status).toBe(404)
  })
})

describe('PATCH …/managed-files/:id — never Legal (S4b)', () => {
  it('a managed file tagged legal: 400 bad_tags with the reason, nothing written', async () => {
    const r = await patch('/managed-files/m1', { tags: ['legal'] })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: tags.LEGAL_MANAGED_REASON, code: 'bad_tags' })
    expect(readRabbitBundle(PID).managedFiles[0].tags).toEqual([])
    expect(writes).toBe(0)
  })

  it('CONTROL: its other tags and notes save; S17 still strips its path fields', async () => {
    const r = await patch('/managed-files/m1', { tags: ['shots'], notes: 'a take', folder_path: '../..', stored_name: 'x' })
    expect(r.status).toBe(200)
    expect(readRabbitBundle(PID).managedFiles[0]).toMatchObject({ tags: ['shots'], notes: 'a take', folder_path: 'ASSETS/hero/', stored_name: 'take.mov' })
  })
})

describe('PATCH …/files/:id — where a file is kept and filed is not a patch (0114)', () => {
  const SENTENCE = "A file's project, folder and storage change only through Move to."

  it('another project\'s id: 409 project_mismatch, nothing written, with an edit beside it or not', async () => {
    const r = await patch('/files/filed', { project_id: 'p-other', description: 'lost' })
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: SENTENCE, code: 'project_mismatch' })
    expect(file('filed').project_id).toBe(PID)
    expect(file('filed').description).toBeUndefined()
    expect(writes).toBe(0)
  })

  it('a folder change: 400 folder_fixed, nothing written, whether to another folder, to none or onto a file with none', async () => {
    for (const [id, folder] of [['filed', 'fd-other'], ['filed', null], ['plain', 'fd-other']]) {
      const r = await patch(`/files/${id}`, { folder_id: folder, description: 'lost' })
      expect(r.status, `${id} → ${folder}`).toBe(400)
      expect(await r.json()).toEqual({ error: SENTENCE, code: 'folder_fixed' })
    }
    expect(file('filed').folder_id).toBe('fd-invoices')
    expect(file('plain').folder_id).toBeUndefined()
    expect(writes).toBe(0)
  })

  it('the adapter\'s own project_id and the row\'s own folder pass, and neither is written over the row', async () => {
    const r = await patch('/files/filed', { project_id: PID, folder_id: 'fd-invoices', description: 'kept' })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ id: 'filed', project_id: PID, folder_id: 'fd-invoices', description: 'kept' })
    expect(writes).toBe(1)
    // A row that has neither gains neither: the same id and a blank folder are nothing to store.
    const bare = await patch('/files/plain', { project_id: PID, folder_id: null, description: 'kept' })
    expect(bare.status).toBe(200)
    expect(file('plain')).not.toHaveProperty('project_id')
    expect(file('plain')).not.toHaveProperty('folder_id')
    expect(file('plain').description).toBe('kept')
  })

  it('workspace_id, thumbnail_url and is_financial are dropped, and the edit beside them saves', async () => {
    const r = await patch('/files/filed', { workspace_id: 'w-other', thumbnail_url: 'elsewhere.jpg', is_financial: false, document_kind: 'brief' })
    expect(r.status).toBe(200)
    expect(file('filed')).toMatchObject({ is_financial: true, document_kind: 'brief' })
    expect(file('filed')).not.toHaveProperty('workspace_id')
    expect(file('filed')).not.toHaveProperty('thumbnail_url')
    // The flag picks the directory the body resolves against (main.cjs), so flipping it would lose the file.
    const flagged = await patch('/files/plain', { is_financial: true })
    expect(flagged.status).toBe(200)
    expect(file('plain')).not.toHaveProperty('is_financial')
  })

  it('the refusal comes first: a foreign id with a bad tag says the id, and writes nothing', async () => {
    const r = await patch('/files/plain', { project_id: 'p-other', tags: ['notes'] })
    expect(r.status).toBe(409)
    expect(writes).toBe(0)
  })

  it('what the real desktop adapter sends goes through: its id in the URL and in the body', async () => {
    const r = await patch('/files/plain', { description: 'note', project_id: PID })
    expect(r.status).toBe(200)
    expect((await patch('/files/plain', { is_core_definer: true, project_id: PID })).status).toBe(200)
    expect((await patch('/files/plain', { tags: ['creative', 'shots'], project_id: PID })).status).toBe(200)
    expect(file('plain')).toMatchObject({ description: 'note', is_core_definer: true, tags: ['creative', 'shots'] })
  })
})

describe('PATCH …/managed-files/:id — the same rule (0114)', () => {
  const managed = () => readRabbitBundle(PID).managedFiles[0]

  it('another project\'s id is 409 and a folder is 400, nothing written', async () => {
    const foreign = await patch('/managed-files/m1', { project_id: 'p-other', notes: 'lost' })
    expect(foreign.status).toBe(409)
    expect((await foreign.json()).code).toBe('project_mismatch')
    const filed = await patch('/managed-files/m1', { folder_id: 'fd-other', notes: 'lost' })
    expect(filed.status).toBe(400)
    expect((await filed.json()).code).toBe('folder_fixed')
    expect(managed().notes).toBeUndefined()
    expect(writes).toBe(0)
  })

  it('CONTROL: the note the file window sends, with its project_id and the rest dropped, saves', async () => {
    const r = await patch('/managed-files/m1', { notes: 'a take', project_id: PID, folder_id: null, workspace_id: 'w-other', thumbnail_url: 'x.jpg', is_financial: true })
    expect(r.status).toBe(200)
    expect(managed()).toMatchObject({ notes: 'a take', folder_path: 'ASSETS/hero/' })
    for (const k of ['project_id', 'folder_id', 'workspace_id', 'thumbnail_url', 'is_financial']) expect(managed(), k).not.toHaveProperty(k)
  })
})

describe('the module refuses to mount without its checks', () => {
  it('names the missing dependency', () => {
    expect(() => mountProjectFilePatch(express(), { readRabbitBundle, writeRabbitBundle, rabbitNotFound, checkFileTags: tags.checkFileTags }))
      .toThrow(/checkLegalPatch is required/)
  })
})
