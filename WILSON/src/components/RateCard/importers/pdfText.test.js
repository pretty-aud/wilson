// =============================================================================
// pdfText.test.js — the desktop's PDF text route (electron/pdfText.cjs) through
// a real express app, with the SAME global json parser main.cjs mounts in
// front of it, and the rate card's PDF import (pdfImporter.js) through it.
//
// F13 (2026-11-19; OUTSTANDING F12-02): from 2026-04-06 the route called the
// installed pdf-parse (2.4.5) as the 1.x function it is not, so it answered
// 500 on every call; intake read every PDF as empty and the import said
// "extract-pdf 500". What this pins: a PDF built here (the repository keeps
// none) answers its words and its page count; two pages answer both pages'
// words in page order, a blank line between them, and no marker line (the
// package writes "-- 1 of 2 --" after each page unless told otherwise); a body
// that is not a PDF, an empty one and a PDF locked with a password are refused
// in plain words (422), a missing dataUrl as before (400); the importer shows
// those words, and reads a rate card's rows from both pages of one; and
// requiring the route's module loads none of the package, so the desktop's
// startup pays nothing for it.
//
// 🚨 The package's first load took up to 3.5 s on her PC (Node 20, cold), so
// every case that reads a PDF gives itself FIRST_LOAD_MS: the five-second
// default would make a case here fail by chance.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createRequire } from 'node:module'
import express from 'express'
import { importPdf } from './pdfImporter.js'

const require = createRequire(import.meta.url)
const { mountPdfText } = require('../../../../electron/pdfText.cjs')
const pdfParseLoaded = () => Object.keys(require.cache).some((k) => /[\\/]node_modules[\\/]pdf-parse[\\/]/.test(k))
// Read here, before any case has read a PDF.
const pdfParseLoadedByTheRequire = pdfParseLoaded()

const FIRST_LOAD_MS = 30_000

// The importer asks the desktop's server; here that is the route mounted below.
const server = vi.hoisted(() => ({ base: null }))
vi.mock('../../../lib/localData', () => ({ hasLocalServer: () => true }))
vi.mock('../../../lib/localServerFetch.js', () => ({
  localFetch: (url, init) => fetch(`${server.base}${url}`, init),
}))

// A PDF built by hand: a catalog, its pages, one Helvetica font, one text
// stream per page (each line 16 points below the last) and the
// cross-reference table computed from the bytes. `password` adds a Standard
// security handler whose O and U no password makes, so a reader asks for a
// password before it reads anything.
function pdfOf(pages, { password = false } = {}) {
  const str = (s) => `(${String(s).replace(/[\\()]/g, (c) => `\\${c}`)})`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  pages.forEach((lines, i) => {
    const ops = ['BT', '/F1 12 Tf', '72 720 Td', ...lines.map((l, j) => `${j ? '0 -16 Td ' : ''}${str(l)} Tj`), 'ET'].join('\n')
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`)
  })
  if (password) objs.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'A1'.repeat(32)}> /U <${'B2'.repeat(32)}> /P -44 >>`)
  let out = '%PDF-1.4\n'
  const at = objs.map((body, i) => {
    const offset = Buffer.byteLength(out, 'latin1')
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  const locked = password ? ` /Encrypt ${objs.length} 0 R /ID [<${'C3'.repeat(16)}> <${'C3'.repeat(16)}>]` : ''
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${locked} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
const dataUrlOf = (bytes) => `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`

const TWO_PAGES = [['Producer 1250 5000', 'Director 2000'], ['Editor 900 3600', 'Colorist 1100']]
const NOT_A_PDF = 'This file is not a PDF, or it is damaged.'
const LOCKED = 'This PDF is locked with a password. Save a copy without the password and try again.'

// The importer reads its file as a data URL; node has no FileReader, so this
// one does what a browser's does with a File, from the file's bytes.
class FileReaderOfBytes {
  readAsDataURL(file) {
    file.arrayBuffer().then((bytes) => {
      this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`
      this.onload()
    }, (err) => { this.error = err; this.onerror() })
  }
}

let listener
const logged = []
beforeAll(async () => {
  const app = express()
  app.use(express.json({ limit: '50mb' })) // exactly what main.cjs mounts globally
  mountPdfText(app, { log: (...a) => logged.push(a.join(' ')) })
  await new Promise((r) => { listener = app.listen(0, '127.0.0.1', r) })
  server.base = `http://127.0.0.1:${listener.address().port}`
  vi.stubGlobal('FileReader', FileReaderOfBytes)
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise((r) => listener.close(r))
})

const post = (body) => fetch(`${server.base}/api/extract-pdf`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/extract-pdf', () => {
  it('a one-page PDF answers its words and numPages 1', async () => {
    const r = await post({ name: 'rates.pdf', dataUrl: dataUrlOf(pdfOf([['Hello WILSON rate card 1250']])) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ name: 'rates.pdf', text: 'Hello WILSON rate card 1250', numPages: 1 })
  }, FIRST_LOAD_MS)

  it('two pages answer both pages\' words in page order, a blank line between, and no marker line', async () => {
    const r = await post({ name: 'two.pdf', dataUrl: dataUrlOf(pdfOf(TWO_PAGES)) })
    expect(r.status).toBe(200)
    const { text, numPages } = await r.json()
    expect(numPages).toBe(2)
    expect(text).toBe('Producer 1250 5000\nDirector 2000\n\nEditor 900 3600\nColorist 1100')
    expect(text).not.toMatch(/^-- \d+ of \d+ --$/m)
  }, FIRST_LOAD_MS)

  it('a body that is not a PDF, or an empty one, is refused in words (422) and is not logged as a failure', async () => {
    for (const bytes of [Buffer.from('Role, Day rate\nProducer, 1250\n'), Buffer.alloc(0)]) {
      const r = await post({ name: 'rates.pdf', dataUrl: dataUrlOf(bytes) })
      expect(r.status).toBe(422)
      expect(await r.json()).toEqual({ error: NOT_A_PDF })
    }
    expect(logged).toEqual([])
  }, FIRST_LOAD_MS)

  it('a PDF locked with a password is refused in words (422)', async () => {
    const r = await post({ name: 'locked.pdf', dataUrl: dataUrlOf(pdfOf([['Secret 1250']], { password: true })) })
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: LOCKED })
  }, FIRST_LOAD_MS)

  it('a missing or non-string dataUrl is 400, as before', async () => {
    for (const body of [{ name: 'rates.pdf' }, { name: 'rates.pdf', dataUrl: 42 }, {}]) {
      const r = await post(body)
      expect(r.status).toBe(400)
      expect(await r.json()).toEqual({ error: 'dataUrl is required' })
    }
  })

  it('requiring the route\'s module loads none of pdf-parse; the first read does', async () => {
    expect(pdfParseLoadedByTheRequire).toBe(false)
    const r = await post({ name: 'rates.pdf', dataUrl: dataUrlOf(pdfOf([['Gaffer 950']])) })
    expect(r.status).toBe(200)
    expect(pdfParseLoaded()).toBe(true)
  }, FIRST_LOAD_MS)
})

describe('the rate card\'s PDF import, through the route', () => {
  const fileOf = (bytes, name = 'rates.pdf') => new File([bytes], name, { type: 'application/pdf' })

  it('reads the rows of both pages, from the words alone', async () => {
    const out = await importPdf(fileOf(pdfOf(TWO_PAGES)), 'USD')
    expect(out.errors).toEqual([])
    expect(out.rows.map((r) => [r.role_label, r.day_rate, r.week_rate, r.currency])).toEqual([
      ['Producer', 1250, 5000, 'USD'], ['Director', 2000, null, 'USD'],
      ['Editor', 900, 3600, 'USD'], ['Colorist', 1100, null, 'USD'],
    ])
    // The lines the scan saw: two, a blank line, two. The package's own text, a marker line after each page, is eleven.
    expect(out.totalRows).toBe(5)
  }, FIRST_LOAD_MS)

  it('shows the route\'s words for a file that is not a PDF', async () => {
    const out = await importPdf(fileOf(Buffer.from('Role, Day rate\nProducer, 1250\n')), 'USD')
    expect(out.rows).toEqual([])
    expect(out.errors).toEqual([`PDF text extraction failed: ${NOT_A_PDF}`])
  }, FIRST_LOAD_MS)

  it('shows the route\'s words for a PDF locked with a password', async () => {
    const out = await importPdf(fileOf(pdfOf([['Secret 1250']], { password: true }), 'locked.pdf'), 'USD')
    expect(out.rows).toEqual([])
    expect(out.errors).toEqual([`PDF text extraction failed: ${LOCKED}`])
  }, FIRST_LOAD_MS)
})
