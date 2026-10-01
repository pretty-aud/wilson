// =============================================================================
// projectFileStream.test.js — the streamed project-file upload
// (electron/projectFileStream.cjs) through a real express app on a temp
// root, with the SAME global json parser main.cjs mounts in front of it.
//
// What this pins: a body far above the json limit lands on disk intact and
// its row, directory and 'uploaded' event match what the base64 POST writes;
// a financial scope goes to INVOICES; an unknown project is 404; a missing
// name is 400; a name with separators is sanitised; no .part file survives.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountProjectFileStream, parseScope, parseSize, parseDuration, parseIsoDate } = require('../../../../electron/projectFileStream.cjs')
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
