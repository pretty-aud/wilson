// ============================================================
// csvImporter — parse a CSV file/text into rate card entries
// ============================================================
//
// We hand-roll a small CSV parser to avoid pulling in another
// dependency. It supports:
//   - quoted fields with embedded commas, newlines, and escaped
//     quotes ("" inside a quoted field)
//   - both \n and \r\n line endings
//   - mixed quoted/unquoted on the same line
//
// The first non-empty row is treated as the header. Empty rows
// (or rows where role_label is missing) are skipped silently.
//
// Returns:
//   { rows, columns, unmapped, totalRows, errors }

import { mapHeaders, normalizeRow } from './headerMap'

// ─── Tokenizer ───
function parseCsvText(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = text.length

  while (i < len) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }

    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }

    if (ch === '\r') {
      i += 1
      continue
    }

    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }

    field += ch
    i += 1
  }

  // Flush the last field/row if non-empty.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Strip rows that are entirely empty strings.
  return rows.filter(r => r.some(c => c && c.trim() !== ''))
}

// ─── Public API ───
export async function importCsv(fileOrText, defaultCurrency = 'USD') {
  let text
  if (typeof fileOrText === 'string') {
    text = fileOrText
  } else if (fileOrText && typeof fileOrText.text === 'function') {
    text = await fileOrText.text()
  } else {
    throw new Error('importCsv: expected a File or string input')
  }

  const raw = parseCsvText(text)
  if (raw.length === 0) {
    return { rows: [], columns: {}, unmapped: [], totalRows: 0, errors: [] }
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

  return { rows, columns, unmapped, totalRows: raw.length - 1, errors }
}
