// ============================================================
// pdfImporter — heuristic rate card extraction from a PDF
// ============================================================
//
// Pipeline:
//   1. Convert the file to a data URL.
//   2. POST to /api/extract-pdf (the same Express route the
//      RABBIT intake pipeline already uses; pdf-parse runs in
//      the Electron main process).
//   3. Run a regex-driven heuristic line scanner to pluck out
//      role / rate rows. We look for lines that contain:
//        - a text label (the role)
//        - 1-3 numeric values (day / week / month rates)
//        - an optional currency code or symbol
//   4. Filter obvious non-rate rows (totals, headers, page nums).
//
// The result has the same shape as csvImporter / xlsxImporter.

const CURRENCY_SYMBOLS = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  '₹': 'INR', '₩': 'KRW', 'R$': 'BRL',
}

const ISO_CODES = new Set([
  'USD','EUR','GBP','CAD','AUD','JPY','CNY','INR','BRL','MXN',
  'CHF','SEK','NOK','DKK','NZD','SGD','HKD','KRW','ZAR',
])

// Heuristic skip list — lines that look like headers/totals.
const SKIP_PATTERNS = [
  /^page\s+\d+/i,
  /^total[s]?\b/i,
  /^subtotal/i,
  /^rate\s*card/i,
  /^confidential/i,
  /^©/,
]

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Strip thousands separators ("1,500" → "1500") only when the
// commas appear in groups of three. Leaves European decimal commas
// alone.
function normalizeNumberish(s) {
  // 1,500 → 1500   (US thousands)
  return s.replace(/(\d),(\d{3}\b)/g, '$1$2')
}

function detectCurrency(line) {
  // ISO code first.
  const iso = line.match(/\b([A-Z]{3})\b/)
  if (iso && ISO_CODES.has(iso[1])) return iso[1]
  // Symbol next.
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (line.includes(sym)) return code
  }
  return null
}

// Try to interpret a single line as a rate card row.
// Returns a partial entry or null.
function parseLine(line, idx, defaultCurrency) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length < 4) return null
  if (SKIP_PATTERNS.some(p => p.test(trimmed))) return null

  // Find numeric tokens. Match optional currency symbol, then a
  // number with optional thousands separators and an optional
  // decimal portion. We accept either US (1,500.00) or plain
  // (1500.00) — European decimal commas are out of scope.
  const norm = normalizeNumberish(trimmed)
  const numRe = /[$€£¥₹₩]?\s*(\d{3,7}(?:\.\d{1,2})?)/g
  const nums = []
  let m
  while ((m = numRe.exec(norm)) !== null) {
    nums.push({ value: Number(m[1]), index: m.index, length: m[0].length })
  }
  if (nums.length === 0) return null
  if (nums.length > 4) return null  // probably a table grid line

  // The role label is whatever sits to the LEFT of the first
  // number. Strip trailing punctuation and column dividers.
  const firstNumIdx = nums[0].index
  let label = norm.slice(0, firstNumIdx)
    .replace(/[|\t]/g, ' ')
    .replace(/[:;,.\-–—]+\s*$/, '')
    .trim()

  if (!label || label.length < 2) return null
  // Reject labels that are mostly digits.
  if (/^\d+$/.test(label)) return null
  // Reject labels with no letters.
  if (!/[a-zA-Z]/.test(label)) return null

  const currency = detectCurrency(norm) || defaultCurrency

  // Heuristic mapping: 1 number → day rate; 2 → day + week;
  // 3 → day + week + month. The values are usually presented
  // smallest-to-largest left-to-right.
  let day_rate = null
  let week_rate = null
  let month_rate = null
  const sorted = nums.map(n => n.value).sort((a, b) => a - b)
  if (sorted.length === 1) {
    day_rate = sorted[0]
  } else if (sorted.length === 2) {
    day_rate = sorted[0]
    week_rate = sorted[1]
  } else if (sorted.length >= 3) {
    day_rate = sorted[0]
    week_rate = sorted[1]
    month_rate = sorted[2]
  }

  return {
    role_label: label,
    role_slug: label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
    currency,
    day_rate,
    week_rate,
    month_rate,
    region: null,
    project_size: null,
    source_row: idx + 1,
  }
}

// ─── Public API ───
export async function importPdf(file, defaultCurrency = 'USD') {
  if (!file || extOf(file.name) !== 'pdf') {
    throw new Error('importPdf: expected a .pdf file')
  }

  const dataUrl = await fileToDataUrl(file)

  let text = ''
  try {
    const res = await fetch('/api/extract-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, dataUrl }),
    })
    if (!res.ok) throw new Error(`extract-pdf ${res.status}`)
    const data = await res.json()
    text = data?.text || ''
  } catch (err) {
    return {
      rows: [],
      columns: {},
      unmapped: [],
      totalRows: 0,
      errors: [`PDF text extraction failed: ${err.message || String(err)}`],
    }
  }

  if (!text.trim()) {
    return {
      rows: [],
      columns: {},
      unmapped: [],
      totalRows: 0,
      errors: ['PDF appears to be empty or image-only — heuristic extraction needs selectable text.'],
    }
  }

  // Heuristic line scan.
  const lines = text.split(/\r?\n/)
  const rows = []
  let scanned = 0
  for (let i = 0; i < lines.length; i++) {
    scanned += 1
    const entry = parseLine(lines[i], i, defaultCurrency)
    if (entry) rows.push(entry)
  }

  // De-duplicate by slug — PDFs sometimes repeat header rows on
  // each page break.
  const seen = new Set()
  const deduped = []
  for (const r of rows) {
    if (seen.has(r.role_slug)) continue
    seen.add(r.role_slug)
    deduped.push(r)
  }

  const errors = []
  if (deduped.length === 0) {
    errors.push('No rate-like rows detected. The PDF may be a table image, or use a layout the heuristic does not recognize.')
  }

  // Surface an empty `columns` map; the preview modal still
  // renders fine because it iterates the parsed rows.
  return {
    rows: deduped,
    columns: { role_label: 0 },  // sentinel; not actually used downstream
    unmapped: [],
    totalRows: scanned,
    errors,
  }
}
