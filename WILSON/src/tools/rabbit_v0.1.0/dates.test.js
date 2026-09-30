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
import { parseIsoDate, toIsoDate, showDate, calendarDaysBetween, projectDayCounts } from './dates.js'
import { jsCode } from './rabbitCssGuards.js'

// The zone to go back to, read BEFORE any switch. Deleting TZ does not
// restore it (Node keeps the zone it last applied — review round 1 measured
// it), and an empty TZ is UTC, so the zone's own name is assigned back.
const ORIGINAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
afterAll(() => { process.env.TZ = ORIGINAL_ZONE })

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
      process.env.TZ = ORIGINAL_ZONE
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

  it('reads the shorter date-only forms locally too, keeps a year below 100, and writes four-digit years (review round 1)', () => {
    inZone('America/New_York')
    // 'YYYY-MM' and 'YYYY' are the other two forms the language reads as UTC.
    expect(new Date('2026-12').getDate()).toBe(30)
    expect(toIsoDate(parseIsoDate('2026-12'))).toBe('2026-12-01')
    expect(toIsoDate(parseIsoDate('2026'))).toBe('2026-01-01')
    // `new Date(26, 11, 1)` is 1926; the helper keeps year 26.
    expect(parseIsoDate('0026-12-01').getFullYear()).toBe(26)
    expect(toIsoDate(parseIsoDate('0026-12-01'))).toBe('0026-12-01')
    expect(toIsoDate(parseIsoDate('0999-01-01'))).toBe('0999-01-01')
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

describe('calendarDaysBetween: whole days on the local calendar (the Tasks view\'s "Days remaining" and "Days passed")', () => {
  it('counts across both daylight-saving changes exactly, from stored dates or Dates', () => {
    inZone('America/New_York')
    expect(calendarDaysBetween('2026-10-15', '2026-12-18')).toBe(64)   // across 1 Nov (an hour gained)
    expect(calendarDaysBetween('2027-03-01', '2027-03-15')).toBe(14)   // across 14 Mar (an hour lost)
    expect(calendarDaysBetween(new Date(2026, 8, 30, 21, 30), '2026-12-18')).toBe(79) // an evening "today"
    expect(calendarDaysBetween('2026-12-18', '2026-10-15')).toBe(-64)
    expect(calendarDaysBetween(null, '2026-12-18')).toBeNull()
  })
  it('east of UTC too (review round 2: a later date read with `new Date(s)` and ceiled passes every New York case and gives 65 in Tokyo)', (ctx) => {
    if (!inZone('Asia/Kolkata')) ctx.skip('this runner could not switch to Asia/Kolkata') // +5:30, no daylight saving
    expect(calendarDaysBetween('2026-10-15', '2026-12-18')).toBe(64)
    expect(calendarDaysBetween(new Date(2026, 9, 15, 21, 30), '2026-12-18')).toBe(64)
    process.env.TZ = 'Asia/Tokyo'
    if (new Date(2026, 11, 1).getTimezoneOffset() !== -540) ctx.skip('this runner could not switch to Asia/Tokyo')
    expect(calendarDaysBetween('2026-10-15', '2026-12-18')).toBe(64)
    // What that fault computes, here: the later date at 09:00, ceiled.
    expect(Math.ceil((new Date('2026-12-18') - new Date(2026, 9, 15)) / 86400000)).toBe(65)
  })
  it('CONTROL: Math.ceil of the milliseconds between two local midnights (the tiles\' original arithmetic, with the parse already fixed) counts the gained November hour as a day', () => {
    inZone('America/New_York')
    const [a, b] = [new Date(2026, 9, 15), new Date(2026, 11, 18)]
    expect(Math.ceil((b - a) / 86400000)).toBe(65)
  })
})

describe('projectDayCounts: the Tasks view\'s "Days remaining" and "Days passed" (review round 2: the arithmetic, not only its helper)', () => {
  const P = { start_date: '2026-08-03', end_date: '2026-12-18' }
  for (const tz of ['America/New_York', 'Pacific/Kiritimati']) {
    it(`in ${tz}: an evening "today" in the middle, the first day, before the start, after the end, and no dates`, (ctx) => {
      if (!inZone(tz)) ctx.skip(`this runner could not switch to ${tz}`)
      expect(projectDayCounts(P, new Date(2026, 8, 30, 21, 30))).toEqual({ daysRemaining: 79, daysPassed: 58 })
      expect(projectDayCounts(P, new Date(2026, 7, 3, 9, 0))).toEqual({ daysRemaining: 137, daysPassed: 0 })
      expect(projectDayCounts(P, new Date(2026, 6, 1))).toEqual({ daysRemaining: 170, daysPassed: 0 })
      expect(projectDayCounts(P, new Date(2027, 0, 5))).toEqual({ daysRemaining: 0, daysPassed: 155 })
      expect(projectDayCounts({ start_date: null, end_date: '' }, new Date(2026, 8, 30))).toEqual({ daysRemaining: '—', daysPassed: '—' })
      expect(projectDayCounts(null, new Date(2026, 8, 30))).toEqual({ daysRemaining: '—', daysPassed: '—' })
    })
  }
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
/** Every call to `name(` in code, with its FIRST argument (a paren-depth
    scan, so `new Date(a.b || f(c))` is read whole). */
function firstArgs(code, name) {
  const out = []
  const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`, 'g')
  let m
  while ((m = re.exec(code))) {
    let depth = 1, i = re.lastIndex, arg = null
    for (; i < code.length && depth > 0; i++) {
      const c = code[i]
      if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) depth--
      else if (c === ',' && depth === 1 && arg === null) arg = code.slice(re.lastIndex, i)
    }
    out.push({ call: code.slice(m.index, i), arg: (arg ?? code.slice(re.lastIndex, i - 1)).trim() })
  }
  return out
}
/** A first argument that can be a stored date string: a stored field read
    off a row (dotted, optional-chained or bracketed), a template, or a bare
    name the old code used for one. */
const STORED_ARG = /(?:\.|\?\.)\s*(?:start_date|end_date|due_date|date)\b|\[\s*['"`](?:start_date|end_date|due_date|date)['"`]\s*\]|\$\{|^(?:value|iso|s|str|dateStr|raw)$/
/** The defect's spellings in code (comments stripped): a stored date handed
    to `new Date(…)`, directly or through the Timeline's `startOfDay` /
    `addDays` (they clone with `new Date(d)`), and — banned outright in these
    three files, review round 2 — the UTC readers `Date.parse`, `toJSON()`
    and `toISOString()`. */
const rawDateReads = (src) => {
  const code = jsCode(src)
  const bad = []
  for (const name of ['new Date', 'startOfDay', 'addDays']) {
    for (const { call, arg } of firstArgs(code, name)) if (STORED_ARG.test(arg)) bad.push(call)
  }
  for (const m of code.matchAll(/Date\.parse\(|\.toJSON\(\)|\.toISOString\(\)/g)) bad.push(m[0])
  return bad
}
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
    // A stored string through the Timeline's cloning helpers is the same read.
    expect(rawDateReads('const s = addDays(task.start_date, 2)\nconst x = startOfDay(ms.date)\nconst y = startOfDay(value)')).toHaveLength(3)
    // Review round 2's spellings, each caught.
    for (const s of [
      'new Date(project.end_date || 0)', 'new Date(`${x.start_date}`)', "new Date(x['start_date'])", "new Date(row.end_date + '')",
      'Date.parse(x.date)', 'd.toJSON().slice(0, 10)', "d.toISOString().replace(/T.*/, '')",
    ]) expect(rawDateReads(s), s).toHaveLength(1)
    // …and what the files keep is not: now, a Date copied, a timestamp's getTime, a Date's arithmetic, the y-m-d constructor.
    expect(rawDateReads('const t = new Date()\nconst x = new Date(d)\nnew Date(today.getTime() + 1)\naddDays(span.start, 3)\nstartOfDay(new Date())\naddDays(startDate, 7)\nnew Date(y, m - 1, day)')).toEqual([])
    // A comment that names the defect is not code.
    expect(rawDateReads('// `new Date(value)` read it as UTC midnight')).toEqual([])
    expect(importsHelper("import { showDate } from '../../tools/rabbit_v0.1.0/dates.js'")).toBe(true)
    expect(importsHelper("// import { showDate } from '../dates.js'")).toBe(false)
  })
})
