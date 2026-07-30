// ============================================================
// googleSheetImporter — pull a public Google Sheet as CSV
// ============================================================
//
// Accepts any of the common Google Sheets URL flavors and
// rewrites it to the gviz CSV export endpoint, which is the
// most reliable for "anyone with the link can view" sheets:
//
//   https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=<GID>
//
// Recognized inputs:
//   1. https://docs.google.com/spreadsheets/d/<ID>/edit#gid=<GID>
//   2. https://docs.google.com/spreadsheets/d/<ID>/edit?usp=sharing
//   3. https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>
//   4. https://docs.google.com/spreadsheets/d/e/<PUB-ID>/pub?output=csv
//
// CORS from the renderer to docs.google.com is unreliable, so
// the actual fetch goes through the local Express server's
// /api/fetch-raw passthrough route.

import { importCsv } from './csvImporter'
import { hasLocalServer } from '../../../lib/localData'

// Extract the spreadsheet ID and (optional) GID from any Google
// Sheets URL we recognize. Returns null if we can't make sense
// of the input.
export function parseGoogleSheetUrl(url) {
  if (!url) return null
  let parsed
  try { parsed = new URL(url.trim()) } catch { return null }
  if (!/(^|\.)google\.com$/i.test(parsed.hostname)) return null
  if (!/spreadsheets/.test(parsed.pathname)) return null

  // /spreadsheets/d/<ID>/...
  const idMatch = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!idMatch) return null
  const id = idMatch[1]

  // GID lives either in the search params (?gid=) or the hash
  // (#gid=). Default to 0 (first sheet) if absent.
  let gid = parsed.searchParams.get('gid')
  if (!gid && parsed.hash) {
    const hashMatch = parsed.hash.match(/gid=(\d+)/)
    if (hashMatch) gid = hashMatch[1]
  }
  if (!gid) gid = '0'

  // Detect a published-to-web URL. Those use /d/e/<PUB-ID> rather
  // than /d/<ID>; they need the pub?output=csv endpoint instead
  // of gviz.
  const isPub = /\/spreadsheets\/d\/e\//.test(parsed.pathname)

  return { id, gid, isPub }
}

export function buildCsvExportUrl({ id, gid, isPub }) {
  if (isPub) {
    return `https://docs.google.com/spreadsheets/d/e/${id}/pub?output=csv&single=true&gid=${gid}`
  }
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`
}

export async function importGoogleSheet(url, defaultCurrency = 'USD') {
  const parsed = parseGoogleSheetUrl(url)
  if (!parsed) {
    return {
      rows: [],
      columns: {},
      unmapped: [],
      totalRows: 0,
      errors: ['Could not recognize that as a Google Sheets URL.'],
    }
  }

  const exportUrl = buildCsvExportUrl(parsed)

  // Session 12: the CSV fetch is proxied by the local Express server (a
  // browser can't fetch cross-origin) — surface the real reason on the web.
  if (!hasLocalServer()) {
    return {
      rows: [],
      columns: {},
      unmapped: [],
      totalRows: 0,
      errors: ['Google Sheets import runs in the desktop app only. Download the sheet as CSV and import the file instead.'],
    }
  }

  let csvText
  try {
    const res = await fetch('/api/fetch-raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: exportUrl }),
    })
    const data = await res.json()
    if (!res.ok) {
      const hint = data?.status === 401 || data?.status === 403
        ? ' Make sure the sheet is shared as "Anyone with the link can view".'
        : ''
      return {
        rows: [],
        columns: {},
        unmapped: [],
        totalRows: 0,
        errors: [`Failed to fetch sheet: ${data?.error || res.statusText}.${hint}`],
      }
    }
    csvText = data?.body || ''
  } catch (err) {
    return {
      rows: [],
      columns: {},
      unmapped: [],
      totalRows: 0,
      errors: [`Network error: ${err.message || String(err)}`],
    }
  }

  if (!csvText.trim()) {
    return {
      rows: [],
      columns: {},
      unmapped: [],
      totalRows: 0,
      errors: ['Sheet response was empty.'],
    }
  }

  // Hand off to the CSV parser; the result shape already matches
  // the importer contract.
  return await importCsv(csvText, defaultCurrency)
}
