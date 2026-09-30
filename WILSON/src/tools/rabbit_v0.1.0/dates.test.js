// =============================================================================
// dates.test.js — a stored date lands on the day it names, in every zone
// (post-overhaul S1, 2026-09-30; rulings B3–B5).
//
// The defect: `new Date('2026-12-01')` is UTC midnight, so west of Greenwich
// the local day is the 30th and every Timeline bar drew a day early. The
// helper must name the same day whatever zone the machine is in, so these
// run in several: Node applies `process.env.TZ` when it is assigned, and each
// zone is checked to have TAKEN (its offset read back) before a result counts.
// =============================================================================
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseIsoDate, toIsoDate, showDate } from './dates.js'
import { jsCode } from './rabbitCssGuards.js'

const ORIGINAL_TZ = process.env.TZ
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

/** Zone → its offset on 1 Dec 2026 (minutes WEST of UTC, as getTimezoneOffset
    reports), so a switch that did not take is caught rather than trusted. */
const ZONES = {
  'America/New_York': 300,    // Audrey's machine: the defect's home
  'America/Los_Angeles': 480,
  'Pacific/Pago_Pago': 660,   // UTC−11, the far west
  UTC: 0,
  'Asia/Kolkata': -330,       // a half-hour zone
  'Pacific/Kiritimati': -840, // UTC+14, the far east
}
function inZone(tz) {
  process.env.TZ = tz
  return new Date(2026, 11, 1).getTimezoneOffset() === ZONES[tz]
}

describe('parseIsoDate: a date-only string is the local midnight of the day it names', () => {
  for (const tz of Object.keys(ZONES)) {
    it(`in ${tz}: 2026-12-01 is the 1st, and toIsoDate gives the same string back`, (ctx) => {
      if (!inZone(tz)) ctx.skip(`this runner could not switch to ${tz}`)
      const d = parseIsoDate('2026-12-01')
      expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 1, 0, 0])
      expect(toIsoDate(parseIsoDate('2026-12-01'))).toBe('2026-12-01')
    })

    it(`in ${tz}: every day of 2026 and 2027 round-trips (the DST days included)`, (ctx) => {
      if (!inZone(tz)) ctx.skip(`this runner could not switch to ${tz}`)
      const bad = []
      for (let i = 0; i < 730; i++) {
        const d = new Date(Date.UTC(2026, 0, 1 + i))
        const iso = d.toISOString().slice(0, 10) // UTC arithmetic: an exact calendar day, whatever the zone
        const back = parseIsoDate(iso)
        if (toIsoDate(back) !== iso || back.getDate() !== Number(iso.slice(8)) || back.getHours() !== 0) bad.push(iso)
      }
      expect(bad).toEqual([])
    })
  }

  it('CONTROL: the parse it replaces, `new Date(s)`, reads 2026-12-01 as the 30th west of Greenwich', (ctx) => {
    // The brief's control, on the machine's own zone when the runner cannot
    // switch: meaningful only where the offset is positive (west of UTC).
    if (!inZone('America/New_York')) {
      process.env.TZ = ORIGINAL_TZ ?? ''
      if (!(new Date().getTimezoneOffset() > 0)) ctx.skip('the machine is not west of UTC and the zone could not be switched')
    }
    expect(new Date('2026-12-01').getDate()).not.toBe(1)
    expect(new Date('2026-12-01').getDate()).toBe(30)
    // …and the helper, in the same zone, does not.
    expect(parseIsoDate('2026-12-01').getDate()).toBe(1)
  })

  it('keeps the language\'s reading for everything that is not a bare date: a timestamp is an instant, a Date is copied', () => {
    inZone('America/New_York')
    const ts = '2026-12-01T12:00:00Z'
    expect(parseIsoDate(ts).getTime()).toBe(new Date(ts).getTime())
    const local = new Date(2026, 11, 3, 15, 30)
    const copy = parseIsoDate(local)
    expect(copy).not.toBe(local)
    expect(copy.getTime()).toBe(local.getTime())
  })

  it('answers null — never an Invalid Date — for nothing, garbage and a day the calendar does not have', () => {
    for (const v of [null, undefined, '', 'soon', '2026-02-30', '2026-13-01', '2026-00-10', new Date(NaN)]) {
      expect(parseIsoDate(v), String(v)).toBeNull()
      expect(toIsoDate(v), String(v)).toBeNull()
    }
    // A leap day is a day.
    expect(toIsoDate(parseIsoDate('2028-02-29'))).toBe('2028-02-29')
  })
})

describe('toIsoDate: the local y-m-d a DATE column stores', () => {
  it('writes the local day of a Date, whatever its time — the evening case the UTC slice got wrong', () => {
    inZone('America/New_York')
    const evening = new Date(2026, 8, 30, 21, 30) // 21:30 Eastern is 01:30 UTC the next day
    expect(evening.toISOString().slice(0, 10)).toBe('2026-10-01') // what `toISOString().slice(0, 10)` stored
    expect(toIsoDate(evening)).toBe('2026-09-30')
  })
})

describe('showDate: a stored date as a reader sees it', () => {
  it('formats the day the string names, in the system\'s short date by default or the options given', () => {
    inZone('America/New_York')
    expect(showDate('2026-12-01', { locale: 'en-US', month: 'short', day: 'numeric', year: 'numeric' })).toBe('Dec 1, 2026')
    expect(showDate('2026-12-01', { locale: 'en-US' })).toBe('12/01/2026')
    // The Projects page's old reading of the same string (P1-20): a day early.
    expect(new Date('2026-12-01').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })).toBe('Nov 30, 2026')
  })

  it('an em dash for no date; a string that is not a date comes back as it was', () => {
    expect(showDate(null)).toBe('—')
    expect(showDate('')).toBe('—')
    expect(showDate('TBD')).toBe('TBD')
  })
})

// ── The consumers read through here (B5: one helper) ──────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
const CONSUMERS = {
  'the Timeline': 'views/TimelineView.jsx',
  'the Tasks view': 'views/ProjectTasksView.jsx',
  'the Projects page (P1-20)': '../../components/Projects/ProjectListPanel.jsx',
}
const source = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
/** The defect's two spellings in code (comments stripped): a stored date
    handed to `new Date(…)`, and a date cut out of the UTC `toISOString()`. */
const rawDateReads = (src) => [...jsCode(src).matchAll(
  /new Date\(\s*(?:[\w?]+(?:\.|\?\.))*(?:start_date|end_date|due_date|date|startDate|endDate|value|iso)\s*\)|toISOString\(\)\s*\.\s*(?:slice|split|substring|substr)\(/g,
)].map((m) => m[0])
const importsHelper = (src) => /import\s*\{[^}]*\}\s*from\s*'(?:\.\.?\/)+(?:tools\/rabbit_v0\.1\.0\/)?dates\.js'/.test(jsCode(src))

describe('the Timeline, the Tasks view and the Projects page read dates through dates.js (B5)', () => {
  for (const [who, rel] of Object.entries(CONSUMERS)) {
    it(`${who} imports the helper and reads no stored date with new Date(field) or toISOString()`, () => {
      const src = source(rel)
      expect(importsHelper(src), rel).toBe(true)
      expect(rawDateReads(src), rel).toEqual([])
    })
  }

  it('the Timeline\'s own parseDate and toDateInputValue are the helper\'s, and it keeps no second toIsoDate', () => {
    const code = jsCode(source('views/TimelineView.jsx'))
    expect(code).toMatch(/function parseDate\(value\) \{\s*const d = parseIsoDate\(value\)\s*return d \? startOfDay\(d\) : null\s*\}/)
    expect(code).toMatch(/function toDateInputValue\(value\) \{\s*return toIsoDate\(value\) \?\? ''\s*\}/)
    expect(code).not.toMatch(/function toIsoDate\(/)
  })

  it('CONTROL: the shapes it replaced, planted back, are caught', () => {
    const tl = source('views/TimelineView.jsx')
    const planted = tl.replace('const d = parseIsoDate(value)', 'const d = new Date(value)')
    expect(planted).not.toBe(tl)
    expect(rawDateReads(planted)).toEqual(['new Date(value)'])
    expect(rawDateReads("const end = new Date(project.end_date)\nconst s = new Date(project?.start_date)")).toHaveLength(2)
    expect(rawDateReads("ctx.addMilestone({ date: new Date().toISOString().slice(0, 10) })")).toHaveLength(1)
    expect(rawDateReads("return new Date(iso).toLocaleDateString('en-US')")).toHaveLength(1)
    // …and what the files keep is not: now, a Date copied, a timestamp's getTime.
    expect(rawDateReads('const t = new Date()\nconst x = new Date(d)\nnew Date(today.getTime() + 1)')).toEqual([])
    // A comment that names the defect is not code.
    expect(rawDateReads('// `new Date(value)` read it as UTC midnight')).toEqual([])
    expect(importsHelper("import { showDate } from '../../tools/rabbit_v0.1.0/dates.js'")).toBe(true)
    expect(importsHelper("// import { showDate } from '../dates.js'")).toBe(false)
  })
})
