// =============================================================================
// ids.js — deterministic ids and dates for the fixture dataset.
//
// Every fixture id is a valid UUID so nothing downstream (uuid validation,
// Postgres-shaped columns, the folder planner) treats it as odd, and every id
// is STABLE across reloads so a screenshot taken today matches one taken
// tomorrow. The layout is
//
//   f1c70000-KKKK-4000-8000-NNNNNNNNNNNN
//
// where KKKK names the entity kind and N counts within it. `f1c7` reads as
// "fict" — a fixture id is recognisable at a glance in any table.
// =============================================================================

const KINDS = {
  workspace: '0001', member: '0002', project: '0003', phase: '0004',
  asset: '0005', task: '0006', dependency: '0007', link: '0008',
  file: '0009', folder: '000a', comment: '000b', version: '000c',
  scene: '000d', shot: '000e', bin: '000f', binFile: '0010',
  binRoot: '0011', take: '0012', rateCard: '0013', rateEntry: '0014',
  budgetLine: '0015', budgetActual: '0016', budgetVersion: '0017',
  expense: '0018', override: '0019', note: '001a', noteSubject: '001b',
  milestone: '001c', template: '001d', history: '001e', fileEvent: '001f',
  course: '0020', subject: '0021', quiz: '0022', run: '0023',
}

export function fid(kind, n) {
  const k = KINDS[kind]
  if (!k) throw new Error(`[fixtures] unknown id kind "${kind}"`)
  return `f1c70000-${k}-4000-8000-${String(n).padStart(12, '0')}`
}

export const FIXTURE_ID_PREFIX = 'f1c70000-'

/** ISO date (YYYY-MM-DD) `days` after 2026-08-03, the project's first day. */
const EPOCH = Date.UTC(2026, 7, 3)
export function day(days) {
  return new Date(EPOCH + days * 86400000).toISOString().slice(0, 10)
}

/** ISO timestamp for the same offset, at a fixed office hour. */
export function stamp(days, hour = 10, minute = 0) {
  return new Date(EPOCH + days * 86400000 + (hour * 60 + minute) * 60000).toISOString()
}

/** The fixture's "today" (the session that asked for this ran on 2026-09-11). */
export const TODAY_OFFSET = 39
export const TODAY = day(TODAY_OFFSET)
