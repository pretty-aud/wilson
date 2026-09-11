// =============================================================================
// store.js — the in-memory database the fixture backends read and write.
//
// One `createStore()` per app session: the dataset is deep-copied in, so a
// write mutates the copy and the next read sees it, and a reload starts
// clean. Every read the adapters hand out is a clone too, so React state
// never aliases a store row (a bug there would look like realtime).
//
// Soft-deleted tables (0014) carry `deleted_at`; readers filter it. Nothing
// here imports the Supabase client, `fetch`, or anything that could reach a
// network — devFixtures.test.js greps this directory for exactly that.
// =============================================================================

import { WORKSPACE, MEMBERS } from './data/workspace'
import {
  PROJECT, PHASES, MILESTONES, ASSETS, TASKS, DEPENDENCIES, TASK_LINKS,
  COMMENTS, ASSET_VERSIONS, EDIT_HISTORY, PROJECT_MEMBERS, TASK_TEMPLATES,
} from './data/project'
import { SCENES, SHOTS, LEVELS, EXPERIENCES, BINS, BIN_FILES, BIN_ROOTS, SHOT_TAKES } from './data/scenes'
import { FOLDERS, FILES, THUMBNAILS, FILE_EVENTS } from './data/files'
import {
  RATE_CARDS, RATE_CARD_ENTRIES, BUDGET_LINES, BUDGET_ACTUALS, BUDGET_VERSIONS,
  EXPENSES, PROJECT_RATE_OVERRIDES,
} from './data/money'
import { NOTES, NOTE_SUBJECTS } from './data/notes'
import { COURSE, SUBJECTS, PROGRESS, QUIZ_ATTEMPTS } from './data/otter'

export function clone(v) {
  if (v === undefined) return undefined
  return structuredClone(v)
}

let counter = 0
/** A fresh id for rows the session creates. Valid v4 shape, marked "f1c7" + "aa". */
export function newId() {
  counter += 1
  const tail = `${Date.now().toString(16)}${counter.toString(16)}`.slice(-12).padStart(12, '0')
  return `f1c7aa00-0000-4000-8000-${tail}`
}

export function now() {
  return new Date().toISOString()
}

export function createStore() {
  const progress = {}
  progress[COURSE.id] = clone(PROGRESS)
  return {
    workspace: clone(WORKSPACE),
    members: clone(MEMBERS),

    projects: [clone(PROJECT)],
    phases: clone(PHASES),
    milestones: clone(MILESTONES),
    assets: clone(ASSETS),
    tasks: clone(TASKS),
    dependencies: clone(DEPENDENCIES),
    taskLinks: clone(TASK_LINKS),
    comments: clone(COMMENTS),
    assetVersions: clone(ASSET_VERSIONS),
    editHistory: clone(EDIT_HISTORY),
    projectMembers: clone(PROJECT_MEMBERS),
    taskTemplates: clone(TASK_TEMPLATES),
    ingestionRuns: [],
    ingestionChunks: [],

    scenes: clone(SCENES),
    shots: clone(SHOTS),
    levels: clone(LEVELS),
    experiences: clone(EXPERIENCES),
    bins: clone(BINS),
    // Posters live beside the rows, keyed by id, so a removed-then-restored row
    // (the UI hands back the stripped row) gets its picture back (review round 1).
    binFiles: BIN_FILES.map(({ __poster, ...f }) => clone(f)),
    posters: new Map(BIN_FILES.map(f => [f.id, f.__poster])),
    binRoots: clone(BIN_ROOTS),
    shotTakes: clone(SHOT_TAKES),

    folders: clone(FOLDERS),
    files: clone(FILES),
    fileEvents: clone(FILE_EVENTS),
    thumbnails: new Map(THUMBNAILS),
    manifests: {},
    ratesMirror: {},

    rateCards: clone(RATE_CARDS),
    rateCardEntries: clone(RATE_CARD_ENTRIES),
    budgetLines: clone(BUDGET_LINES),
    budgetActuals: clone(BUDGET_ACTUALS),
    budgetVersions: clone(BUDGET_VERSIONS),
    expenses: clone(EXPENSES),
    rateOverrides: clone(PROJECT_RATE_OVERRIDES),

    notes: clone(NOTES),
    noteSubjects: clone(NOTE_SUBJECTS),

    courses: [clone(COURSE)],
    subjects: clone(SUBJECTS),
    progress,
    quizAttempts: clone(QUIZ_ATTEMPTS),
  }
}

// ── Row helpers ──────────────────────────────────────────────────────────────

export function findById(list, id) {
  return list.find(r => r.id === id) || null
}

export function live(list) {
  return list.filter(r => !r.deleted_at)
}

/** Insert or merge by id; stamps updated_at. Returns the stored row. */
export function upsert(list, row, { idKey = 'id' } = {}) {
  const id = row[idKey] || newId()
  const i = list.findIndex(r => r[idKey] === id)
  const ts = now()
  if (i === -1) {
    const created = { created_at: ts, ...row, [idKey]: id, updated_at: ts }
    list.push(created)
    return created
  }
  list[i] = { ...list[i], ...row, [idKey]: id, updated_at: ts }
  return list[i]
}

export function patch(list, id, fields) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1) throw notFound(id)
  list[i] = { ...list[i], ...fields, updated_at: now() }
  return list[i]
}

export function remove(list, id) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1) return false
  list.splice(i, 1)
  return true
}

export function softDelete(list, id, by) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1) throw notFound(id)
  list[i] = { ...list[i], deleted_at: now(), deleted_by: by ?? null }
  return list[i]
}

/** Returns true when the row was deleted and is now live (the RPC's boolean). */
export function restore(list, id) {
  const i = list.findIndex(r => r.id === id)
  if (i === -1 || !list[i].deleted_at) return false
  list[i] = { ...list[i], deleted_at: null, deleted_by: null }
  return true
}

export function notFound(id) {
  const err = new Error(`[fixtures] no row ${id}`)
  err.status = 404
  err.code = 'not_found'
  return err
}
