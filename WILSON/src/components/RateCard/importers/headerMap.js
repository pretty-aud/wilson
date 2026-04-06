// ============================================================
// headerMap — column header → schema field mapping
// ============================================================
//
// Both the CSV and XLSX importers normalize their header rows
// through this module so the rest of the pipeline always works
// in schema field names. The XLSX importer additionally uses
// `inferRow()` to coerce values into the right types.
//
// Field shape returned by importers:
//   { role_label, role_slug, currency, day_rate, week_rate,
//     month_rate, region, project_size, source_row }

const SYNONYMS = {
  role_label: [
    'role', 'role label', 'role name', 'position', 'title', 'job title',
    'job', 'discipline', 'department', 'function',
  ],
  role_slug: [
    'slug', 'role slug', 'role id', 'code', 'role code', 'id',
  ],
  day_rate: [
    'day rate', 'daily rate', 'day', 'daily', 'per day', '/day', 'rate per day',
    'day_rate', 'dayrate', 'days', 'd-rate',
  ],
  week_rate: [
    'week rate', 'weekly rate', 'week', 'weekly', 'per week', '/week',
    'week_rate', 'weekrate', 'weeks', 'w-rate',
  ],
  month_rate: [
    'month rate', 'monthly rate', 'month', 'monthly', 'per month', '/month',
    'month_rate', 'monthrate', 'months', 'm-rate',
  ],
  currency: [
    'currency', 'curr', 'ccy', 'unit',
  ],
  region: [
    'region', 'country', 'location', 'territory', 'market', 'geo',
  ],
  project_size: [
    'project size', 'size', 'tier', 'band', 'project_size', 'budget tier',
  ],
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Build a flat lookup table once.
const LOOKUP = (() => {
  const m = new Map()
  for (const [field, syns] of Object.entries(SYNONYMS)) {
    for (const s of syns) m.set(norm(s), field)
  }
  return m
})()

// Returns { columns: { field: index }, unmapped: [{header, index}] }
export function mapHeaders(headerRow) {
  const columns = {}
  const unmapped = []
  headerRow.forEach((raw, idx) => {
    const key = norm(raw)
    if (!key) return
    const field = LOOKUP.get(key)
    if (field && columns[field] === undefined) {
      columns[field] = idx
    } else {
      unmapped.push({ header: String(raw || ''), index: idx })
    }
  })
  return { columns, unmapped }
}

// Coerce raw cell to a schema field type.
function coerceNumeric(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  // Strip currency symbols, separators, whitespace.
  const cleaned = String(value).replace(/[^\d.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function coerceText(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

// Detect a 3-letter currency code in a cell that may be either a
// pure code ("USD") or a numeric cell adjacent to a code.
function coerceCurrency(value, fallback = 'USD') {
  if (!value) return fallback
  const m = String(value).toUpperCase().match(/[A-Z]{3}/)
  return m ? m[0] : fallback
}

function makeSlug(label) {
  return String(label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// Convert a raw row (array) into a normalized partial entry using
// the column index map. `rowIndex` is the 1-based source row, used
// to seed `source_row` for traceability.
export function normalizeRow(row, columns, rowIndex, defaultCurrency = 'USD') {
  const get = (field) => {
    const idx = columns[field]
    return idx === undefined ? undefined : row[idx]
  }

  const role_label = coerceText(get('role_label'))
  if (!role_label) return null  // skip blank rows

  const explicitSlug = coerceText(get('role_slug'))
  const role_slug = explicitSlug || makeSlug(role_label)

  return {
    role_label,
    role_slug,
    currency: coerceCurrency(get('currency'), defaultCurrency),
    day_rate: coerceNumeric(get('day_rate')),
    week_rate: coerceNumeric(get('week_rate')),
    month_rate: coerceNumeric(get('month_rate')),
    region: coerceText(get('region')) || null,
    project_size: coerceText(get('project_size')) || null,
    source_row: rowIndex,
  }
}
