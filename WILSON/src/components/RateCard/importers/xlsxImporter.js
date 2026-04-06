// ============================================================
// xlsxImporter — parse an XLSX/XLS workbook into rate card entries
// ============================================================
//
// Reads the first sheet of the workbook and runs it through the
// shared header-mapping pipeline. SheetJS (`xlsx@0.18.5`) is the
// only third-party dep added for this importer — Apache-2.0,
// available on npm.
//
// Returns the same shape as csvImporter:
//   { rows, columns, unmapped, totalRows, errors, sheetName }
//
// SheetJS is loaded via dynamic import so the ~350KB library only
// hits the wire when the user actually picks a workbook.

import { mapHeaders, normalizeRow } from './headerMap'

export async function importXlsx(file, defaultCurrency = 'USD') {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('importXlsx: expected a File input')
  }

  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.SheetNames[0]
  if (!firstSheet) {
    return { rows: [], columns: {}, unmapped: [], totalRows: 0, errors: ['Workbook contains no sheets.'], sheetName: null }
  }

  const sheet = workbook.Sheets[firstSheet]
  // header: 1 returns rows as arrays; defval: '' fills blanks.
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false })

  if (raw.length === 0) {
    return { rows: [], columns: {}, unmapped: [], totalRows: 0, errors: [], sheetName: firstSheet }
  }

  const headerRow = raw[0]
  const { columns, unmapped } = mapHeaders(headerRow)

  if (columns.role_label === undefined) {
    return {
      rows: [],
      columns,
      unmapped,
      totalRows: raw.length - 1,
      errors: ['Could not find a role / role label column. Expected one of: role, role label, position, title.'],
      sheetName: firstSheet,
    }
  }

  const rows = []
  const errors = []
  for (let r = 1; r < raw.length; r++) {
    try {
      const entry = normalizeRow(raw[r], columns, r + 1, defaultCurrency)
      if (entry) rows.push(entry)
    } catch (err) {
      errors.push(`Row ${r + 1}: ${err.message || String(err)}`)
    }
  }

  return { rows, columns, unmapped, totalRows: raw.length - 1, errors, sheetName: firstSheet }
}
