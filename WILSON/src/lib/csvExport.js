// ─────────────────────────────────────────────────────────────────────────────
// csvExport — Session 14, Block B (CSV / spreadsheet export, both tiers).
//
// The one CSV writer for every export surface: per-page buttons (tasks,
// rate card, roster) and the Admin Terminal workspace takeout. Pure
// serialization + a browser download helper — no data fetching in here;
// callers pass the rows they are ALREADY allowed to see (exports ride
// RLS-scoped reads, never a DEFINER sweep — locked #20 discipline).
//
// Format choices:
//   - CRLF line endings + a UTF-8 BOM so Excel opens files correctly
//     (including non-ASCII names) without an import wizard.
//   - RFC 4180 quoting: fields containing " , \n \r are quoted, quotes
//     doubled.
//   - Formula-injection guard: a STRING starting with = + @ or a
//     non-numeric - or + gets a leading apostrophe, so a malicious cell
//     ("=HYPERLINK(...)") pasted into a project name can never execute
//     when the CSV is opened in a spreadsheet (TPN posture). Real numbers
//     are unaffected.
//   - null/undefined → empty; objects/arrays → JSON.
// ─────────────────────────────────────────────────────────────────────────────

/** Guard + stringify one cell value. */
export function csvCell(v) {
  if (v === null || v === undefined) return ''
  let s
  if (v instanceof Date) {
    s = v.toISOString() // JSON.stringify(Date) would embed literal quotes
  } else if (typeof v === 'object') {
    try { s = JSON.stringify(v) } catch { s = String(v) }
  } else {
    s = String(v)
  }
  // Formula-injection guard (strings only; keep plain numbers intact).
  if (typeof v === 'string' && /^[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`
  }
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Serialize rows to CSV text.
 * @param {object[]} rows
 * @param {Array<{key: string, header?: string, map?: (row) => any}>} [columns]
 *   Column spec; omitted → union of keys across rows, in first-seen order.
 */
export function toCsv(rows = [], columns = null) {
  let cols = columns
  if (!cols) {
    const seen = new Set()
    cols = []
    for (const r of rows) {
      for (const k of Object.keys(r || {})) {
        if (!seen.has(k)) { seen.add(k); cols.push({ key: k }) }
      }
    }
  }
  const lines = [cols.map(c => csvCell(c.header ?? c.key)).join(',')]
  for (const r of rows) {
    lines.push(cols.map(c => csvCell(c.map ? c.map(r) : r?.[c.key])).join(','))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the click a tick before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Serialize + download rows as a .csv file. */
export function downloadCsv(filename, rows, columns = null) {
  downloadBlob(filename, new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }))
}

/** `2026-07-30` style stamp for export filenames. */
export function exportDateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
