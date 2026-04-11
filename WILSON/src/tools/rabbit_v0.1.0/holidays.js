// ============================================================
// RABBIT — Holiday / blocked-day registry
// ============================================================
//
// Each entry is { date: 'YYYY-MM-DD', title: 'Holiday name' }.
// Persisted to localStorage under `rabbit-holidays-v2` as a
// JSON array of objects. The `countWorkingDays` helper only
// checks the date keys (a Set<string>) for fast lookup.
//
// The default seed contains US federal bank holidays for 2024-2028
// so users have a useful starting point. They can add/remove
// individual dates and import a CSV to bulk-load more.

const HOLIDAYS_KEY = 'rabbit-holidays-v2'
// Migration key — if v1 exists but v2 doesn't, we discard v1
// and re-seed (the v1 format was a plain string array without
// titles, so there's nothing meaningful to migrate).
const HOLIDAYS_KEY_V1 = 'rabbit-holidays-v1'

// ── US federal bank holidays 2024–2028 ──────────────────────
const US_BANK_HOLIDAYS_SEED = [
  // 2024
  { date: '2024-01-01', title: "New Year's Day" },
  { date: '2024-01-15', title: 'Martin Luther King Jr. Day' },
  { date: '2024-02-19', title: "Presidents' Day" },
  { date: '2024-05-27', title: 'Memorial Day' },
  { date: '2024-06-19', title: 'Juneteenth' },
  { date: '2024-07-04', title: 'Independence Day' },
  { date: '2024-09-02', title: 'Labor Day' },
  { date: '2024-10-14', title: 'Columbus Day' },
  { date: '2024-11-11', title: 'Veterans Day' },
  { date: '2024-11-28', title: 'Thanksgiving' },
  { date: '2024-12-25', title: 'Christmas Day' },
  // 2025
  { date: '2025-01-01', title: "New Year's Day" },
  { date: '2025-01-20', title: 'Martin Luther King Jr. Day' },
  { date: '2025-02-17', title: "Presidents' Day" },
  { date: '2025-05-26', title: 'Memorial Day' },
  { date: '2025-06-19', title: 'Juneteenth' },
  { date: '2025-07-04', title: 'Independence Day' },
  { date: '2025-09-01', title: 'Labor Day' },
  { date: '2025-10-13', title: 'Columbus Day' },
  { date: '2025-11-11', title: 'Veterans Day' },
  { date: '2025-11-27', title: 'Thanksgiving' },
  { date: '2025-12-25', title: 'Christmas Day' },
  // 2026
  { date: '2026-01-01', title: "New Year's Day" },
  { date: '2026-01-19', title: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', title: "Presidents' Day" },
  { date: '2026-05-25', title: 'Memorial Day' },
  { date: '2026-06-19', title: 'Juneteenth' },
  { date: '2026-07-03', title: 'Independence Day (observed)' },
  { date: '2026-09-07', title: 'Labor Day' },
  { date: '2026-10-12', title: 'Columbus Day' },
  { date: '2026-11-11', title: 'Veterans Day' },
  { date: '2026-11-26', title: 'Thanksgiving' },
  { date: '2026-12-25', title: 'Christmas Day' },
  // 2027
  { date: '2027-01-01', title: "New Year's Day" },
  { date: '2027-01-18', title: 'Martin Luther King Jr. Day' },
  { date: '2027-02-15', title: "Presidents' Day" },
  { date: '2027-05-31', title: 'Memorial Day' },
  { date: '2027-06-18', title: 'Juneteenth (observed)' },
  { date: '2027-07-05', title: 'Independence Day (observed)' },
  { date: '2027-09-06', title: 'Labor Day' },
  { date: '2027-10-11', title: 'Columbus Day' },
  { date: '2027-11-11', title: 'Veterans Day' },
  { date: '2027-11-25', title: 'Thanksgiving' },
  { date: '2027-12-24', title: 'Christmas Day (observed)' },
  // 2028
  { date: '2028-01-01', title: "New Year's Day" },
  { date: '2028-01-17', title: 'Martin Luther King Jr. Day' },
  { date: '2028-02-21', title: "Presidents' Day" },
  { date: '2028-05-29', title: 'Memorial Day' },
  { date: '2028-06-19', title: 'Juneteenth' },
  { date: '2028-07-04', title: 'Independence Day' },
  { date: '2028-09-04', title: 'Labor Day' },
  { date: '2028-10-09', title: 'Columbus Day' },
  { date: '2028-11-10', title: 'Veterans Day (observed)' },
  { date: '2028-11-23', title: 'Thanksgiving' },
  { date: '2028-12-25', title: 'Christmas Day' },
]

// ── Load / save ─────────────────────────────────────────────
// Returns a Map<string, string> — date → title.
export function loadHolidays() {
  try {
    const raw = localStorage.getItem(HOLIDAYS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const m = new Map()
        for (const entry of arr) {
          if (typeof entry === 'object' && entry.date) {
            m.set(entry.date, entry.title || '')
          } else if (typeof entry === 'string') {
            // Legacy v1 migration — plain string array
            m.set(entry, '')
          }
        }
        return m
      }
    }
  } catch {}
  // Clean up v1 key if present
  try { localStorage.removeItem(HOLIDAYS_KEY_V1) } catch {}
  // First launch — seed with US bank holidays.
  const seed = new Map()
  for (const h of US_BANK_HOLIDAYS_SEED) seed.set(h.date, h.title)
  saveHolidays(seed)
  return seed
}

export function saveHolidays(dateMap) {
  try {
    const arr = [...dateMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, title]) => ({ date, title }))
    localStorage.setItem(HOLIDAYS_KEY, JSON.stringify(arr))
  } catch {}
}

// ── CSV import / export ─────────────────────────────────────
// CSV format: "YYYY-MM-DD,Title" per line. Lines starting
// with # are comments. If no comma, the title is empty.
export function parseHolidayCSV(csvText) {
  const entries = []
  for (const line of csvText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const commaIdx = trimmed.indexOf(',')
    let dateField, titleField
    if (commaIdx >= 0) {
      dateField = trimmed.slice(0, commaIdx).trim()
      titleField = trimmed.slice(commaIdx + 1).trim()
    } else {
      dateField = trimmed
      titleField = ''
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateField)) {
      entries.push({ date: dateField, title: titleField })
    }
  }
  return entries
}

export function exportHolidayCSV(dateMap) {
  const sorted = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  let csv = '# RABBIT — Blocked / holiday dates\n'
  csv += '# Format: YYYY-MM-DD,Title\n'
  for (const [date, title] of sorted) {
    csv += title ? `${date},${title}\n` : `${date}\n`
  }
  return csv
}

// ── Counting helper ─────────────────────────────────────────
// Count weekdays between two Date objects, subtracting any
// dates that appear in the holiday map (only keys are checked).
export function countWorkingDays(startDate, endDate, holidayMap) {
  if (!startDate || !endDate) return 0
  let count = 0
  const d = new Date(startDate)
  while (d <= endDate) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      const iso = d.toISOString().slice(0, 10)
      if (!holidayMap || !holidayMap.has(iso)) {
        count++
      }
    }
    d.setDate(d.getDate() + 1)
  }
  return count
}

export { US_BANK_HOLIDAYS_SEED }
