// =============================================================================
// projectFileStream.test.js — the streamed project-file upload
// (electron/projectFileStream.cjs) through a real express app on a temp
// root, with the SAME global json parser main.cjs mounts in front of it.
//
// What this pins: a body far above the json limit lands on disk intact and
// its row, directory and 'uploaded' event match what the base64 POST writes;
// a financial scope goes to INVOICES; an unknown project is 404; a missing
// name is 400; a name with separators is sanitised; no .part file survives.
//
// OUTSTANDING M1-L7 (Audrey's ruling of 2026-10-30, "Yes, M1 fixes it now"):
// with the host's hook (main.cjs: its planner's INVOICES row and its one row
// writer), both transports file an invoice or a receipt in the project's
// INVOICES category folder — found, or made under the root where the tree
// lacks it — as the cloud's uploadFile does; no tree, no hook, or a hook that
// fails: the top, as before, the failure said without the file's name.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountProjectFileStream, invoicesFolderOfBundle, invoicesFolderHook, parseScope, parseSize, parseDuration, parseIsoDate } = require('../../../../electron/projectFileStream.cjs')
const { randomUUID } = require('node:crypto')

const PID = 'p-stream-1'
const store = new Map()
const readRabbitBundle = (id) => (store.has(id) ? JSON.parse(store.get(id)) : null)
const writeRabbitBundle = (id, bundle) => { store.set(id, JSON.stringify(bundle)) }
function rabbitTouch(row) {
  const now = new Date().toISOString()
  if (!row.id) row.id = randomUUID()
  if (!row.created_at) row.created_at = now
  row.updated_at = now
  return row
}
function rabbitLogFileEvent(bundle, evt) { (bundle.fileEvents ||= []).push({ ...evt, at: new Date().toISOString() }) }
const rabbitNotFound = (res, what = 'project') => res.status(404).json({ error: `${what} not found` })

let root, filesDir, invoicesDir, legalDir, server, base
const logged = []

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-files-stream-'))
  filesDir = path.join(root, 'Legend-Road-Series_FILES')
  invoicesDir = path.join(root, 'INVOICES')
  legalDir = path.join(root, 'LEGAL')
  store.set(PID, JSON.stringify({ project: { id: PID, title: 'Legend Road Series' }, files: [] }))
  const app = express()
  app.use(express.json({ limit: '50mb' })) // exactly what main.cjs mounts globally
  mountProjectFileStream(app, {
    readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitLogFileEvent, rabbitNotFound,
    resolveProjectFilesDir: () => filesDir,
    resolveProjectInvoicesDir: () => invoicesDir,
    resolveProjectLegalDir: () => legalDir,
    uuidv4: randomUUID,
    log: (line) => logged.push(line),
  })
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/rabbit/projects`
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
  fs.rmSync(root, { recursive: true, force: true })
})

const put = (pid, q, body) => fetch(`${base}/${pid}/files-stream?${new URLSearchParams(q)}`, {
  method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body,
})
// The base64 POST, moved here from main.cjs in S4b's review round 1 (R1-BEH-05).
const post = (pid, body) => fetch(`${base}/${pid}/files`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const counts = () => [legalDir, invoicesDir, filesDir].map(d => (fs.existsSync(d) ? fs.readdirSync(d).length : 0))

describe('parseScope / parseSize', () => {
  it('tolerate anything a query string can carry', () => {
    expect(parseScope('{"assetId":"a1","financial":true}')).toEqual({ assetId: 'a1', financial: true })
    expect(parseScope('[1]')).toEqual({})
    expect(parseScope('not json')).toEqual({})
    expect(parseScope(undefined)).toEqual({})
    expect(parseSize('1234')).toBe(1234)
    expect(parseSize('')).toBe(null)
    expect(parseSize('-1')).toBe(null)
    expect(parseSize('abc')).toBe(null)
    expect(parseDuration('92.4567')).toBe(92.457)
    expect(parseDuration('0')).toBe(null)
    expect(parseDuration('')).toBe(null)
    expect(parseDuration('x')).toBe(null)
    expect(parseIsoDate('2026-09-10T12:00:00Z')).toBe('2026-09-10T12:00:00.000Z')
    expect(parseIsoDate('not a date')).toBe(null)
    expect(parseIsoDate('')).toBe(null)
  })
})

describe('PUT …/files-stream', () => {
  it('lands a body well above the json limit on disk, intact, with the POST\'s row and event', async () => {
    const big = Buffer.alloc(64 * 1024 * 1024, 7) // 64 MB > the 50mb json cap
    big.write('HEAD', 0)
    big.write('TAIL', big.length - 4)
    const r = await put(PID, { name: 'Legend Road S01E01.mov', mimeType: 'video/quicktime', sizeBytes: String(big.length), scope: JSON.stringify({ kind: 'source' }), durationSec: '92.457', sourceModifiedAt: '2026-09-10T12:00:00.000Z' }, big)
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row).toMatchObject({
      project_id: PID, name: 'Legend Road S01E01.mov', mime_type: 'video/quicktime',
      size_bytes: big.length, storage_provider: 'local_server', kind: 'source',
      is_core_definer: false, is_financial: false, phase_id: null, asset_id: null, task_id: null,
      duration_sec: 92.457, source_modified_at: '2026-09-10T12:00:00.000Z',
    })
    expect(row.storage_path).toBe(`${row.id}-Legend_Road_S01E01.mov`)
    expect(row.uploaded_at).toBeTruthy()
    expect(row.updated_at).toBeTruthy()
    const onDisk = fs.readFileSync(path.join(filesDir, row.storage_path))
    expect(onDisk.length).toBe(big.length)
    expect(onDisk.subarray(0, 4).toString()).toBe('HEAD')
    expect(onDisk.subarray(-4).toString()).toBe('TAIL')
    expect(fs.readdirSync(filesDir).filter(f => f.includes('.part-'))).toEqual([])
    const bundle = readRabbitBundle(PID)
    expect(bundle.files.map(f => f.id)).toContain(row.id)
    expect(bundle.fileEvents.at(-1)).toMatchObject({ file_id: row.id, event: 'uploaded', new_path: row.storage_path, size_bytes: big.length })
    expect(logged.at(-1)).toContain(row.storage_path)
  }, 30000)

  it('a financial scope goes to INVOICES and marks the row', async () => {
    const r = await put(PID, { name: 'inv-001.pdf', mimeType: 'application/pdf', sizeBytes: '3', scope: JSON.stringify({ financial: true, lineId: 'l1' }) }, Buffer.from('pdf'))
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row.is_financial).toBe(true)
    expect(fs.existsSync(path.join(invoicesDir, row.storage_path))).toBe(true)
    expect(fs.existsSync(path.join(filesDir, row.storage_path))).toBe(false)
    // M1-L7: a host without the INVOICES hook (this mount) files it nowhere.
    expect(row).not.toHaveProperty('folder_id')
  })

  // Post-overhaul S4b (0088): a Legal file goes to the LEGAL folder beside
  // INVOICES and carries the legal tag from upload — the cloud's LEGAL
  // segment and tag, written together. CONTROL: an ordinary upload carries
  // no tag and lands in the files dir.
  it('a Legal scope goes to LEGAL, carries the legal tag, and is not financial (S4b)', async () => {
    const r = await put(PID, { name: 'release.pdf', mimeType: 'application/pdf', sizeBytes: '3', scope: JSON.stringify({ type: 'project', legal: true }) }, Buffer.from('pdf'))
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row.tags).toEqual(['legal'])
    expect(row.is_financial).toBe(false)
    expect(fs.existsSync(path.join(legalDir, row.storage_path))).toBe(true)
    expect(fs.existsSync(path.join(filesDir, row.storage_path))).toBe(false)
    expect(fs.existsSync(path.join(invoicesDir, row.storage_path))).toBe(false)
    expect(readRabbitBundle(PID).files.find(f => f.id === row.id).tags).toEqual(['legal'])
    const plain = await (await put(PID, { name: 'plain.pdf', sizeBytes: '3', scope: JSON.stringify({ type: 'project' }) }, Buffer.from('pdf'))).json()
    expect(plain.tags).toBeUndefined()
    expect(fs.existsSync(path.join(filesDir, plain.storage_path))).toBe(true)
  })

  it('Legal AND financial together is refused, and nothing is written (S4b)', async () => {
    const before = [legalDir, invoicesDir, filesDir].map(d => (fs.existsSync(d) ? fs.readdirSync(d).length : 0))
    const rows = readRabbitBundle(PID).files.length
    const r = await put(PID, { name: 'both.pdf', sizeBytes: '3', scope: JSON.stringify({ legal: true, financial: true }) }, Buffer.from('pdf'))
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('legal_and_financial')
    expect([legalDir, invoicesDir, filesDir].map(d => (fs.existsSync(d) ? fs.readdirSync(d).length : 0))).toEqual(before)
    expect(readRabbitBundle(PID).files.length).toBe(rows)
  })

  it('Legal AND core together is refused, and nothing is written (review round 1, R1-BEH-07)', async () => {
    // files_legal_not_core_chk refuses it in the cloud; the PATCH refused it
    // here; the upload did not, and stored a core Legal file.
    const before = counts()
    const rows = readRabbitBundle(PID).files.length
    const r = await put(PID, { name: 'core.pdf', sizeBytes: '3', scope: JSON.stringify({ type: 'project', legal: true, isCoreDefiner: true }) }, Buffer.from('pdf'))
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.code).toBe('legal_not_core')
    expect(body.error).toBe('A Legal file is never a core file: core files feed Intake and D.O.G., which the whole project reads.')
    expect(counts()).toEqual(before)
    expect(readRabbitBundle(PID).files.length).toBe(rows)
  })

  it('a scope with a document kind and a description lands both on the row (0075, Track C / C3)', async () => {
    // The row is "field for field the base64 POST's", and the POST carries
    // these two since Track C; without them the desktop threw a file's kind
    // and description away on the one transport every upload uses.
    const r = await put(PID, { name: 'Nightjar_brief.pdf', mimeType: 'application/pdf', sizeBytes: '3', scope: JSON.stringify({ documentKind: 'brief', description: 'the v3 brief', isCoreDefiner: true }) }, Buffer.from('pdf'))
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row).toMatchObject({ document_kind: 'brief', description: 'the v3 brief', is_core_definer: true, is_financial: false })
    const bundle = readRabbitBundle(PID)
    expect(bundle.files.find(f => f.id === row.id)).toMatchObject({ document_kind: 'brief', description: 'the v3 brief' })
    // Absent from the scope: null, as the POST writes them — never undefined.
    const r2 = await put(PID, { name: 'plate.png', mimeType: 'image/png', sizeBytes: '3', scope: JSON.stringify({ kind: 'source' }) }, Buffer.from('png'))
    const row2 = await r2.json()
    expect(row2.document_kind).toBe(null)
    expect(row2.description).toBe(null)
  })

  it('records the real size when the caller sends none, and sanitises a name with separators', async () => {
    const r = await put(PID, { name: '../..\\evil name?.png' }, Buffer.from('12345'))
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row.size_bytes).toBe(5)
    expect(row.mime_type).toBe(null)
    expect(row.duration_sec).toBe(null)
    expect(row.source_modified_at).toBe(null)
    expect(row.storage_path).toBe(`${row.id}-.._.._evil_name_.png`)
    expect(fs.existsSync(path.join(filesDir, row.storage_path))).toBe(true)
    expect(fs.existsSync(path.join(root, 'evil name?.png'))).toBe(false)
  })

  it('an unknown project is 404 and a missing name is 400 — nothing written', async () => {
    const before = fs.readdirSync(filesDir).length
    expect((await put('nope', { name: 'x.bin' }, Buffer.from('x'))).status).toBe(404)
    expect((await put(PID, { name: '   ' }, Buffer.from('x'))).status).toBe(400)
    expect(fs.readdirSync(filesDir).length).toBe(before)
  })
})

describe('POST …/files — the base64 transport, beside the stream (S4b review round 1, R1-BEH-05)', () => {
  const b64 = (text) => Buffer.from(text).toString('base64')

  it('an ordinary file goes to the files dir with the stream\'s row and an uploaded event', async () => {
    const r = await post(PID, { name: 'call sheet.pdf', mimeType: 'application/pdf', sizeBytes: 4, base64: b64('call'), scope: { type: 'project' } })
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row).toMatchObject({ project_id: PID, name: 'call sheet.pdf', storage_provider: 'local_server', is_financial: false, is_core_definer: false })
    expect(row.tags).toBeUndefined()
    expect(row.storage_path).toBe(`${row.id}-call_sheet.pdf`)
    expect(fs.readFileSync(path.join(filesDir, row.storage_path), 'utf8')).toBe('call')
    const bundle = readRabbitBundle(PID)
    expect(bundle.files.find(f => f.id === row.id)).toBeTruthy()
    expect(bundle.fileEvents.find(e => e.file_id === row.id)?.event).toBe('uploaded')
  })

  it('a Legal scope goes to LEGAL with the tag, and nowhere else', async () => {
    const r = await post(PID, { name: 'nda.pdf', sizeBytes: 3, base64: b64('nda'), scope: { type: 'project', legal: true } })
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row.tags).toEqual(['legal'])
    expect(row.is_financial).toBe(false)
    expect(row.is_core_definer).toBe(false)
    expect(fs.readFileSync(path.join(legalDir, row.storage_path), 'utf8')).toBe('nda')
    expect(fs.existsSync(path.join(filesDir, row.storage_path))).toBe(false)
    expect(fs.existsSync(path.join(invoicesDir, row.storage_path))).toBe(false)
    expect(readRabbitBundle(PID).files.find(f => f.id === row.id).tags).toEqual(['legal'])
  })

  it('keeps a document kind and a description on the row (0075; planted fault R2-5)', async () => {
    const row = await (await post(PID, { name: 'brief.pdf', base64: b64('b'), scope: { documentKind: 'brief', description: 'the v3 brief' } })).json()
    expect(row).toMatchObject({ document_kind: 'brief', description: 'the v3 brief' })
    const bare = await (await post(PID, { name: 'plate.png', base64: b64('p'), scope: {} })).json()
    expect(bare.document_kind).toBe(null)
    expect(bare.description).toBe(null)
  })

  it('a financial scope goes to INVOICES (CONTROL: the third directory)', async () => {
    const row = await (await post(PID, { name: 'inv.pdf', base64: b64('inv'), scope: { financial: true } })).json()
    expect(row.is_financial).toBe(true)
    expect(row.tags).toBeUndefined()
    expect(fs.existsSync(path.join(invoicesDir, row.storage_path))).toBe(true)
  })

  it('Legal with financial, and Legal with core, are refused before anything is written', async () => {
    const before = counts()
    const rows = readRabbitBundle(PID).files.length
    const both = await post(PID, { name: 'x.pdf', base64: b64('x'), scope: { legal: true, financial: true } })
    expect(both.status).toBe(400)
    expect((await both.json()).code).toBe('legal_and_financial')
    const core = await post(PID, { name: 'y.pdf', base64: b64('y'), scope: { legal: true, isCoreDefiner: true } })
    expect(core.status).toBe(400)
    expect((await core.json()).code).toBe('legal_not_core')
    expect(counts()).toEqual(before)
    expect(readRabbitBundle(PID).files.length).toBe(rows)
  })

  it('an unknown project is 404; a missing name or body is 400', async () => {
    expect((await post('nope', { name: 'a', base64: b64('a') })).status).toBe(404)
    expect((await post(PID, { base64: b64('a') })).status).toBe(400)
    expect((await post(PID, { name: 'a' })).status).toBe(400)
  })
})

// ── M1-L7: an invoice or a receipt in the project's INVOICES folder ─────────

// The planner's own INVOICES row (folderPaths.js; main.cjs's copy of the
// categories is pinned equal to it by folderParity.test.js).
const { planProjectFolders } = await import('../folderPaths')
const PLANNED = planProjectFolders({}).find(f => f.kind === 'category' && f.entityType === 'invoice')
/** A stand-in for main.cjs's addFolderRow: the row under the planned parent, pushed onto the bundle. */
function addFolderRow(bundle, projectId, planned) {
  if (!bundle.folders) bundle.folders = []
  if (bundle.folders.some(f => f.path === planned.path)) return false
  const parent = bundle.folders.find(f => f.path === planned.parentPath)
  bundle.folders.push({ id: `made-${planned.slug}`, project_id: projectId, parent_id: parent ? parent.id : null, kind: planned.kind, entity_type: planned.entityType, slug: planned.slug, label: planned.label, path: planned.path })
  return true
}
const ROOT = { id: 'f-root', kind: 'root', path: '' }
const INVOICES_ROW = { id: 'f-invoices', kind: 'category', path: 'INVOICES', parent_id: 'f-root' }

describe('invoicesFolderOfBundle — the three answers, as the cloud\'s uploadFile gives them', () => {
  it('finds the INVOICES category row, and makes nothing', () => {
    const bundle = { folders: [ROOT, { ...INVOICES_ROW }] }
    expect(PLANNED).toMatchObject({ kind: 'category', path: 'INVOICES', parentPath: '' })
    expect(invoicesFolderOfBundle(bundle, 'p1', { planned: PLANNED, addFolderRow })).toMatchObject({ id: 'f-invoices' })
    expect(bundle.folders).toHaveLength(2)
  })

  it('makes it under the root where the tree lacks it, through the host\'s writer', () => {
    const bundle = { folders: [ROOT] }
    const made = invoicesFolderOfBundle(bundle, 'p1', { planned: PLANNED, addFolderRow })
    expect(made).toMatchObject({ id: 'made-INVOICES', parent_id: 'f-root', kind: 'category', path: 'INVOICES', entity_type: 'invoice' })
    expect(bundle.folders).toContain(made)
  })

  it('a project with no tree is left to the planner: nothing made, no folder', () => {
    for (const bundle of [{}, { folders: [] }, { folders: [{ id: 'x', kind: 'entity', path: 'ASSETS/a' }] }]) {
      expect(invoicesFolderOfBundle(bundle, 'p1', { planned: PLANNED, addFolderRow })).toBeNull()
      expect((bundle.folders || []).some(f => f.path === 'INVOICES')).toBe(false)
    }
  })

  it('another kind of folder at that path is not INVOICES, and the writer makes none over it', () => {
    const bundle = { folders: [ROOT, { id: 'f-custom', kind: 'custom', path: 'INVOICES' }] }
    expect(invoicesFolderOfBundle(bundle, 'p1', { planned: PLANNED, addFolderRow })).toBeNull()
    expect(bundle.folders.filter(f => f.path === 'INVOICES')).toHaveLength(1)
  })
})

describe('invoicesFolderHook — the hook main.cjs builds from its planner and its row writer (review round 1)', () => {
  // The renderer's planner stands in for main.cjs's planProjectFolderList:
  // the same rows, the two category lists pinned equal by folderParity.test.js.
  const hook = invoicesFolderHook({ planProjectFolderList: planProjectFolders, addFolderRow })

  it('finds the planner\'s INVOICES row in the bundle, or makes it under the root', () => {
    const filed = { project: { title: 'Salt Hours' }, folders: [ROOT, { ...INVOICES_ROW }] }
    expect(hook(filed, 'p1')).toMatchObject({ id: 'f-invoices' })
    const lacking = { project: { title: 'Salt Hours' }, folders: [ROOT] }
    expect(hook(lacking, 'p1')).toMatchObject({ id: 'made-INVOICES', parent_id: 'f-root', path: 'INVOICES', entity_type: 'invoice' })
  })

  it('CONTROL: a planner that plans no INVOICES category gives no folder, and makes none', () => {
    const noInvoices = invoicesFolderHook({ planProjectFolderList: (p) => planProjectFolders(p).filter(f => f.entityType !== 'invoice'), addFolderRow })
    const bundle = { project: {}, folders: [ROOT] }
    expect(noInvoices(bundle, 'p1')).toBeNull()
    expect(bundle.folders).toHaveLength(1)
  })
})

describe('both transports with the host\'s INVOICES hook (M1-L7)', () => {
  const P_FILED = 'p-invoices-filed'
  const P_NO_INVOICES = 'p-invoices-missing'
  const P_NO_TREE = 'p-invoices-no-tree'
  const P_HOOK_FAILS = 'p-invoices-hook-fails'
  let srv2, base2
  const logged2 = []
  const put2 = (pid, q, body) => fetch(`${base2}/${pid}/files-stream?${new URLSearchParams(q)}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body })
  const post2 = (pid, body) => fetch(`${base2}/${pid}/files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const folderIdOf = (pid, id) => readRabbitBundle(pid).files.find(f => f.id === id)?.folder_id
  const b64 = (text) => Buffer.from(text).toString('base64')

  beforeAll(async () => {
    store.set(P_FILED, JSON.stringify({ project: { id: P_FILED }, files: [], folders: [ROOT, INVOICES_ROW] }))
    store.set(P_NO_INVOICES, JSON.stringify({ project: { id: P_NO_INVOICES }, files: [], folders: [ROOT] }))
    store.set(P_NO_TREE, JSON.stringify({ project: { id: P_NO_TREE }, files: [] }))
    store.set(P_HOOK_FAILS, JSON.stringify({ project: { id: P_HOOK_FAILS }, files: [], folders: [ROOT, INVOICES_ROW] }))
    const app = express()
    app.use(express.json({ limit: '50mb' }))
    mountProjectFileStream(app, {
      readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitLogFileEvent, rabbitNotFound,
      resolveProjectFilesDir: () => filesDir,
      resolveProjectInvoicesDir: () => invoicesDir,
      resolveProjectLegalDir: () => legalDir,
      uuidv4: randomUUID,
      // As main.cjs wires it (invoicesFolderHook), but for one project whose hook throws.
      invoicesFolderFor: (bundle, projectId) => {
        if (projectId === P_HOOK_FAILS) throw new Error('the bundle\'s folders could not be read')
        return invoicesFolderHook({ planProjectFolderList: planProjectFolders, addFolderRow })(bundle, projectId)
      },
      log: (line) => logged2.push(line),
    })
    await new Promise((r) => { srv2 = app.listen(0, '127.0.0.1', r) })
    base2 = `http://127.0.0.1:${srv2.address().port}/api/rabbit/projects`
  })
  afterAll(async () => { await new Promise((r) => srv2.close(r)) })

  it('the stream files an invoice in the project\'s INVOICES folder, on the row it writes and in the bundle', async () => {
    const r = await put2(P_FILED, { name: 'invoice.pdf', scope: JSON.stringify({ financial: true, lineId: 'l1' }) }, Buffer.from('pdf'))
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row).toMatchObject({ is_financial: true, folder_id: 'f-invoices' })
    expect(folderIdOf(P_FILED, row.id)).toBe('f-invoices')
    expect(readRabbitBundle(P_FILED).folders).toHaveLength(2)
  })

  it('the base64 POST likewise (a receipt: financial, no line)', async () => {
    const row = await (await post2(P_FILED, { name: 'receipt.pdf', base64: b64('rcpt'), scope: { financial: true } })).json()
    expect(row).toMatchObject({ is_financial: true, folder_id: 'f-invoices' })
    expect(folderIdOf(P_FILED, row.id)).toBe('f-invoices')
  })

  it('CONTROL: an ordinary file and a Legal file are filed in no folder by this rule', async () => {
    const plain = await (await put2(P_FILED, { name: 'notes.txt' }, Buffer.from('n'))).json()
    expect(plain).not.toHaveProperty('folder_id')
    const legal = await (await post2(P_FILED, { name: 'release.pdf', base64: b64('l'), scope: { legal: true } })).json()
    expect(legal.tags).toEqual(['legal'])
    expect(legal).not.toHaveProperty('folder_id')
  })

  it('a project whose tree lacks the INVOICES row has it made under the root, kept in the bundle, and the invoice filed in it — by either transport', async () => {
    const r = await put2(P_NO_INVOICES, { name: 'invoice.pdf', scope: JSON.stringify({ financial: true }) }, Buffer.from('pdf'))
    const row = await r.json()
    expect(row.folder_id).toBe('made-INVOICES')
    const folders = readRabbitBundle(P_NO_INVOICES).folders
    expect(folders.find(f => f.id === 'made-INVOICES')).toMatchObject({ parent_id: 'f-root', kind: 'category', path: 'INVOICES' })
    // A second upload finds it: one INVOICES row.
    const again = await (await post2(P_NO_INVOICES, { name: 'invoice-2.pdf', base64: b64('i2'), scope: { financial: true } })).json()
    expect(again.folder_id).toBe('made-INVOICES')
    expect(readRabbitBundle(P_NO_INVOICES).folders.filter(f => f.path === 'INVOICES')).toHaveLength(1)
  })

  it('a project with no tree: nothing made, the invoice at the top', async () => {
    const row = await (await put2(P_NO_TREE, { name: 'invoice.pdf', scope: JSON.stringify({ financial: true }) }, Buffer.from('pdf'))).json()
    expect(row.is_financial).toBe(true)
    expect(row).not.toHaveProperty('folder_id')
    expect(readRabbitBundle(P_NO_TREE).folders).toBeUndefined()
  })

  it('a hook that fails is said in the log without the file\'s name, and the invoice still lands, at the top', async () => {
    logged2.length = 0
    const r = await put2(P_HOOK_FAILS, { name: 'secret-budget-q3.pdf', scope: JSON.stringify({ financial: true }) }, Buffer.from('pdf'))
    expect(r.status).toBe(200)
    const row = await r.json()
    expect(row.is_financial).toBe(true)
    expect(row).not.toHaveProperty('folder_id')
    const said = logged2.filter(l => l.startsWith('[files]'))
    expect(said).toEqual([`[files] ${P_HOOK_FAILS}: the INVOICES folder could not be found or made, so the file sits at the project's top: the bundle's folders could not be read`])
    expect(said.some(l => l.includes('secret-budget'))).toBe(false)
    // CONTROL: the POST says the same.
    logged2.length = 0
    const viaPost = await (await post2(P_HOOK_FAILS, { name: 'secret-budget-q4.pdf', base64: b64('s'), scope: { financial: true } })).json()
    expect(viaPost).not.toHaveProperty('folder_id')
    expect(logged2.filter(l => l.startsWith('[files]'))).toHaveLength(1)
  })
})
