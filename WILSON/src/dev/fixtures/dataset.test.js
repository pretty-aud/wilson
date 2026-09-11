// =============================================================================
// dataset.test.js — the fixture dataset is internally consistent.
//
// Every foreign key resolves, every status is a real vocabulary word, the
// counts the brief asked for are there (one workspace, one project, eight
// people, five phases, forty-odd tasks across every status, files with
// thumbnails, scenes / shots / takes / bins, a budget with crew, talent and
// expenses, two rate cards, notes with bodies, one course), and every id is a
// unique fixture UUID. A dataset edit that breaks a link fails here rather
// than as an "undefined" in a table cell.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as Y from 'yjs'
import { TASK_STATUSES, PRIORITIES } from '../../components/Dashboard/dashboardTaskModel'
import { b64ToU8 } from '../../components/Dashboard/noteSync'
import { BIN_KINDS, COLORS, REVIEW_FLAGS, MEDIA_TYPES } from '../../tools/rabbit_v0.1.0/bins/binMedia'
import { FIXTURE_ID_PREFIX } from './ids'
import { WORKSPACE, MEMBERS, PERMISSIONS, FIXTURE_USER } from './data/workspace'
import {
  PROJECT, PHASES, MILESTONES, ASSETS, TASKS, DEPENDENCIES, TASK_LINKS, COMMENTS,
  ASSET_VERSIONS, EDIT_HISTORY, PROJECT_MEMBERS, TASK_TEMPLATES,
} from './data/project'
import { SCENES, SHOTS, BINS, BIN_FILES, BIN_ROOTS, SHOT_TAKES } from './data/scenes'
import { FOLDERS, FILES, THUMBNAILS, FILE_EVENTS } from './data/files'
import {
  RATE_CARDS, RATE_CARD_ENTRIES, BUDGET_LINES, BUDGET_ACTUALS, BUDGET_VERSIONS, EXPENSES, PROJECT_RATE_OVERRIDES,
} from './data/money'
import { NOTES, NOTE_SUBJECTS } from './data/notes'
import { COURSE, SUBJECTS, PROGRESS, QUIZ_ATTEMPTS } from './data/otter'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ids = (rows) => new Set(rows.map((r) => r.id))
const memberIds = new Set(MEMBERS.map((m) => m.user_id))

// The vocabularies the VIEWS render, read from their source (the views are React
// modules the node environment cannot import). A value not in its list renders as
// an empty <select> — exactly what review round 1 found four times.
const here = dirname(fileURLToPath(import.meta.url))
const src = (rel) => readFileSync(resolve(here, '../..', rel), 'utf8')
const quotedList = (text, name) => {
  const m = text.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`))
  if (!m) throw new Error(`no ${name} in source`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
const abbrList = (text, name) => {
  const m = text.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\n\\]`))
  if (!m) throw new Error(`no ${name} in source`)
  return [...m[1].matchAll(/abbr:\s*'([^']+)'/g)].map((x) => x[1])
}
const scenesSrc = src('tools/rabbit_v0.1.0/views/ScenesView.jsx')
const SCENE_STATUSES = quotedList(scenesSrc, 'SCENE_STATUSES')
const SCENE_TYPES = quotedList(scenesSrc, 'SCENE_TYPES')
const TIME_OF_DAY = quotedList(scenesSrc, 'TIME_OF_DAY_OPTIONS')
const FRAMING = abbrList(scenesSrc, 'FRAMING_OPTIONS')
const CAMERA_MOVEMENT = abbrList(scenesSrc, 'CAMERA_MOVEMENT_OPTIONS')
const assetsSrc = src('tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx')
const ASSET_STATUSES = quotedList(assetsSrc, 'export const ASSET_STATUSES')
const ASSET_TYPES = quotedList(assetsSrc, 'export const ASSET_TYPES')
const BUDGET_TIERS = [...src('components/RateCard/useRateCard.js').matchAll(/value:\s*'(tier_\d)'/g)].map((x) => x[1])
const BUDGET_SHEETS = ['crew', 'talent', 'expenses_travel']
const PROJECT_STATUSES = quotedList(src('tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx'), 'STATUS_OPTIONS')

describe('the workspace and its people', () => {
  it('one workspace, eight people, the reviewer is an admin with a real row', () => {
    expect(MEMBERS.length).toBe(8)
    expect(memberIds.size).toBe(8)
    expect(new Set(MEMBERS.map((m) => m.username)).size).toBe(8)
    expect(MEMBERS.every((m) => m.workspace_id === WORKSPACE.id)).toBe(true)
    expect(MEMBERS.every((m) => m.avatar_url.startsWith('data:image/svg+xml'))).toBe(true)
    expect(MEMBERS.every((m) => m.email.endsWith('.example'))).toBe(true)
    expect(PERMISSIONS).toMatchObject({ role: 'admin', workspaceId: WORKSPACE.id, userId: FIXTURE_USER.user_id })
    expect(MEMBERS.every((m) => ['admin', 'manager', 'user'].includes(m.app_role))).toBe(true)
  })
})

describe('the project', () => {
  it('five phases in order with a timeline, three milestones inside it', () => {
    expect(PROJECT.workspace_id).toBe(WORKSPACE.id)
    expect(PHASES.length).toBe(5)
    expect(PHASES.map((p) => p.sort_order)).toEqual([0, 1, 2, 3, 4])
    for (let i = 1; i < PHASES.length; i++) expect(PHASES[i].start_date > PHASES[i - 1].end_date).toBe(true)
    expect(PHASES[0].start_date).toBe(PROJECT.start_date)
    expect(PHASES[4].end_date).toBe(PROJECT.end_date)
    for (const m of MILESTONES) {
      expect(ids(PHASES).has(m.phase_id)).toBe(true)
      expect(m.date >= PROJECT.start_date && m.date <= PROJECT.end_date).toBe(true)
    }
    expect(PROJECT.producer_id && memberIds.has(PROJECT.producer_id)).toBe(true)
    expect(PROJECT.director_id && memberIds.has(PROJECT.director_id)).toBe(true)
    expect(PROJECT.budget_active_version_id).toBe(BUDGET_VERSIONS.find((v) => v.is_active).id)
  })

  it('fifteen assets, each in a phase, with a thumbnail and a real status and type', () => {
    expect(ASSETS.length).toBe(15)
    expect(ASSET_STATUSES.length).toBe(9)
    expect(PROJECT_STATUSES).toContain(PROJECT.status)
    for (const a of ASSETS) {
      expect(ids(PHASES).has(a.phase_id)).toBe(true)
      expect(ASSET_STATUSES).toContain(a.status)
      expect(ASSET_TYPES).toContain(a.type)
      expect(a.thumbnail_url.startsWith('data:image/svg+xml')).toBe(true)
    }
  })

  it('forty-two tasks across every status and priority, every link resolving', () => {
    expect(TASKS.length).toBe(42)
    const seenStatus = new Set(TASKS.map((t) => t.status))
    for (const s of TASK_STATUSES) expect(seenStatus.has(s), s).toBe(true)
    for (const s of seenStatus) expect(TASK_STATUSES, s).toContain(s) // both directions
    const seenPriority = new Set(TASKS.map((t) => t.priority))
    for (const p of PRIORITIES) expect(seenPriority.has(p), p).toBe(true)
    for (const p of seenPriority) expect(PRIORITIES, p).toContain(p)
    for (const t of TASKS) {
      const asset = ASSETS.find((a) => a.id === t.asset_id)
      expect(asset, t.title).toBeTruthy()
      expect(t.phase_id).toBe(asset.phase_id)
      expect(memberIds.has(t.assignee_id), t.title).toBe(true)
      expect(memberIds.has(t.reviewer_id), t.title).toBe(true)
      expect(t.start_date <= t.end_date).toBe(true)
      expect(t.logged_days <= Math.max(t.bid_days, t.logged_days)).toBe(true)
    }
    const mine = TASKS.filter((t) => t.assignee_id === PERMISSIONS.userId || t.reviewer_id === PERMISSIONS.userId)
    expect(mine.length).toBeGreaterThanOrEqual(10)
  })

  it('dependencies join real tasks or real phases by kind; links, comments, versions, history resolve', () => {
    for (const d of DEPENDENCIES) {
      const pool = d.kind === 'phase' ? ids(PHASES) : ids(TASKS)
      expect(pool.has(d.predecessor_id), d.id).toBe(true)
      expect(pool.has(d.successor_id), d.id).toBe(true)
      expect(d.predecessor_id).not.toBe(d.successor_id)
    }
    for (const l of TASK_LINKS) expect(ids(TASKS).has(l.task_id)).toBe(true)
    for (const c of COMMENTS) {
      const pool = c.entity_type === 'task' ? ids(TASKS) : ids(ASSETS)
      expect(pool.has(c.entity_id)).toBe(true)
      expect(memberIds.has(c.author_user_id)).toBe(true)
    }
    for (const v of ASSET_VERSIONS) expect(ids(ASSETS).has(v.asset_id)).toBe(true)
    for (const h of EDIT_HISTORY) {
      const pool = h.entity_type === 'task' ? ids(TASKS) : ids(ASSETS)
      expect(pool.has(h.entity_id)).toBe(true)
    }
  })

  it('the roster is every member once, with a project role and title; templates carry tasks', () => {
    expect(PROJECT_MEMBERS.length).toBe(8)
    expect(new Set(PROJECT_MEMBERS.map((m) => m.user_id)).size).toBe(8)
    for (const m of PROJECT_MEMBERS) {
      expect(['manager', 'reviewer', 'member']).toContain(m.project_role)
      expect(m.project_title.length).toBeGreaterThan(0)
    }
    expect(PROJECT_MEMBERS.find((m) => m.user_id === PERMISSIONS.userId).project_role).toBe('manager')
    for (const t of TASK_TEMPLATES) expect(t.tasks.length).toBeGreaterThan(0)
  })
})

describe('scenes, shots, bins and takes', () => {
  it('six scenes, sixteen shots, every shot in a scene, every word in the view\'s own vocabulary', () => {
    expect(SCENES.length).toBe(6)
    expect(SHOTS.length).toBe(16)
    expect(SCENE_STATUSES.length).toBe(9)
    expect(FRAMING.length).toBeGreaterThan(5)
    expect(CAMERA_MOVEMENT.length).toBeGreaterThan(10)
    expect(new Set(SCENES.map((s) => s.scene_number)).size).toBe(6)
    for (const s of SCENES) {
      expect(SCENE_STATUSES, s.name).toContain(s.status)
      expect(SCENE_TYPES, s.name).toContain(s.type)
      expect(TIME_OF_DAY, s.name).toContain(s.time_of_day)
    }
    for (const s of SHOTS) {
      expect(ids(SCENES).has(s.scene_id)).toBe(true)
      expect(SCENE_STATUSES, s.name).toContain(s.status)
      expect(FRAMING, s.name).toContain(s.framing)
      // null is the view's own "no movement" (the — option); a word must be one of its abbreviations
      if (s.camera_movement !== null) expect(CAMERA_MOVEMENT, s.name).toContain(s.camera_movement)
    }
  })

  it('bins nest, files sit in bins, roots exist, and takes join real shots and files with one primary each', () => {
    expect(BINS.length).toBe(5)
    for (const b of BINS) {
      if (b.parent_bin_id) expect(ids(BINS).has(b.parent_bin_id)).toBe(true)
      expect(BIN_KINDS).toContain(b.kind)
      if (b.color !== null) expect(COLORS).toContain(b.color)
    }
    for (const f of BIN_FILES) {
      expect(ids(BINS).has(f.bin_id)).toBe(true)
      expect(f.probe_status).toBe('done')
      expect(f.online).toBe(true)
      expect(f.__poster.startsWith('data:image/svg+xml')).toBe(true)
      if (f.scene_id) expect(ids(SCENES).has(f.scene_id)).toBe(true)
      if (f.shot_id) expect(ids(SHOTS).has(f.shot_id)).toBe(true)
      expect(REVIEW_FLAGS).toContain(f.review_flag)
      expect(MEDIA_TYPES).toContain(f.media_type)
      if (f.color !== null) expect(COLORS).toContain(f.color)
    }
    expect(BIN_ROOTS.length).toBeGreaterThan(0)
    const byShot = new Map()
    for (const t of SHOT_TAKES) {
      expect(ids(SHOTS).has(t.shot_id)).toBe(true)
      expect(ids(BIN_FILES).has(t.bin_file_id)).toBe(true)
      expect(['primary', 'part', 'alt']).toContain(t.role)
      byShot.set(t.shot_id, [...(byShot.get(t.shot_id) || []), t])
    }
    for (const [shot, takes] of byShot) {
      expect(takes.filter((t) => t.role === 'primary').length, shot).toBe(1)
      expect(takes.map((t) => t.position).sort()).toEqual(takes.map((_, i) => i))
    }
  })
})

describe('folders and files', () => {
  it('the tree has a root, category folders and an entity folder per asset, scene and shot', () => {
    const root = FOLDERS.find((f) => f.kind === 'root')
    expect(root.path).toBe('')
    expect(root.parent_id).toBeNull()
    for (const f of FOLDERS) {
      if (f.parent_id) expect(ids(FOLDERS).has(f.parent_id), f.path).toBe(true)
      else expect(f.kind).toBe('root')
    }
    expect(FOLDERS.filter((f) => f.kind === 'entity' && f.asset_id).length).toBe(ASSETS.length)
    expect(FOLDERS.filter((f) => f.kind === 'entity' && f.scene_id).length).toBe(SCENES.length)
    expect(FOLDERS.filter((f) => f.kind === 'entity' && f.shot_id).length).toBe(SHOTS.length)
    expect(FOLDERS.some((f) => f.path === 'INVOICES')).toBe(true)
  })

  it('thirty-two files, each in a real folder, with a thumbnail for every picture and video', () => {
    expect(FILES.length).toBe(32)
    for (const f of FILES) {
      expect(ids(FOLDERS).has(f.folder_id), f.name).toBe(true)
      if (f.asset_id) expect(ids(ASSETS).has(f.asset_id)).toBe(true)
      if (f.task_id) expect(ids(TASKS).has(f.task_id)).toBe(true)
      expect(['source', 'reference', 'deliverable', 'export', 'other']).toContain(f.kind)
      if (f.thumbnail_url) expect(THUMBNAILS.has(f.thumbnail_url), f.name).toBe(true)
      expect(f.storage_provider).toBe('supabase')
    }
    expect(FILES.filter((f) => f.thumbnail_url).length).toBeGreaterThan(15)
    for (const e of FILE_EVENTS) expect(ids(FILES).has(e.file_id)).toBe(true)
  })
})

describe('the rate card and the budget', () => {
  it('a general and an internal card; internal entries are salaried members with a wage', () => {
    expect(RATE_CARDS.map((c) => c.type).sort()).toEqual(['general', 'internal'])
    expect(BUDGET_TIERS.length).toBe(4)
    for (const e of RATE_CARD_ENTRIES) {
      expect(ids(RATE_CARDS).has(e.rate_card_id)).toBe(true)
      expect(e.day_rate).toBeGreaterThan(0)
      // The Tier column is a <select> over BUDGET_TIERS; anything else renders blank.
      if (e.project_size !== null) expect(BUDGET_TIERS, e.role_label).toContain(e.project_size)
    }
    const internal = RATE_CARD_ENTRIES.filter((e) => e.rate_card_id === RATE_CARDS[1].id)
    expect(internal.length).toBeGreaterThan(4)
    for (const e of internal) {
      expect(memberIds.has(e.member_id)).toBe(true)
      expect(e.wage).toBeGreaterThan(0)
      expect(MEMBERS.find((m) => m.user_id === e.member_id).is_full_time).toBe(true)
    }
  })

  it('crew, talent and expenses sheets; headers have no cost, members resolve, actuals join lines', () => {
    expect(new Set(BUDGET_LINES.map((l) => l.sheet))).toEqual(new Set(BUDGET_SHEETS))
    for (const l of BUDGET_LINES) {
      if (l.is_section_header) expect(l.cost).toBeNull()
      else expect(l.cost).toBeGreaterThan(0)
      if (l.team_member_id) expect(memberIds.has(l.team_member_id)).toBe(true)
      if (l.sheet === 'talent' && !l.is_section_header) expect(l.talent_type).toBeTruthy()
    }
    for (const a of BUDGET_ACTUALS) {
      expect(ids(BUDGET_LINES).has(a.line_id)).toBe(true)
      if (a.expense_id) expect(ids(EXPENSES).has(a.expense_id)).toBe(true)
    }
    expect(BUDGET_VERSIONS.filter((v) => v.is_active).length).toBe(1)
    for (const o of PROJECT_RATE_OVERRIDES) expect(memberIds.has(o.member_id)).toBe(true)
    for (const e of EXPENSES) {
      for (const id of e.asset_ids) expect(ids(ASSETS).has(id)).toBe(true)
      for (const id of e.task_ids) expect(ids(TASKS).has(id)).toBe(true)
      for (const id of e.file_ids) expect(ids(FILES).has(id)).toBe(true)
    }
  })
})

describe('notes', () => {
  it('every note carries a Yjs document whose paragraphs match its preview', () => {
    expect(NOTES.length).toBe(4)
    const labels = new Set(NOTE_SUBJECTS.map((s) => s.label))
    for (const n of NOTES) {
      expect(labels.has(n.subject)).toBe(true)
      expect(n.body_preview.length).toBeGreaterThan(20)
      const doc = new Y.Doc()
      Y.applyUpdate(doc, b64ToU8(n.ydoc_state))
      const frag = doc.getXmlFragment('default')
      expect(frag.length).toBeGreaterThanOrEqual(3)
      expect(frag.toString()).toContain('<paragraph>')
      expect(frag.toString()).toContain(n.body_preview.slice(0, 30))
      doc.destroy()
    }
  })
})

describe('the O.T.T.E.R. course', () => {
  it('four subjects of sections and lessons, progress that names real lessons, two quiz attempts', () => {
    expect(SUBJECTS.length).toBe(4)
    expect(SUBJECTS.every((s) => s.course_id === COURSE.id)).toBe(true)
    expect(SUBJECTS.map((s) => s.subject_order)).toEqual([0, 1, 2, 3])
    const lessonIds = new Map()
    for (const s of SUBJECTS) {
      expect(s.sections.length).toBeGreaterThanOrEqual(2)
      for (const sec of s.sections) {
        expect(sec.lessons.length).toBeGreaterThanOrEqual(1)
        for (const l of sec.lessons) {
          expect(l.content.length).toBeGreaterThan(40)
          lessonIds.set(s.slug, [...(lessonIds.get(s.slug) || []), l.id])
        }
      }
    }
    for (const [slug, p] of Object.entries(PROGRESS.completed_lessons)) {
      expect(lessonIds.has(slug), slug).toBe(true)
      for (const id of p.completed_lessons) expect(lessonIds.get(slug), `${slug}/${id}`).toContain(id)
    }
    // The documents' shapes are what Otter.jsx renders: `category` on both, the
    // shortcut's windows/mac columns, the function's syntax/example.
    expect(COURSE.hotkeys.categories.length).toBeGreaterThan(0)
    for (const c of COURSE.hotkeys.categories) {
      expect(typeof c.category).toBe('string')
      for (const s of c.shortcuts) expect(Object.keys(s)).toEqual(expect.arrayContaining(['action', 'key', 'windows', 'mac']))
    }
    expect(COURSE.functions.categories.length).toBeGreaterThan(0)
    for (const c of COURSE.functions.categories) {
      expect(typeof c.category).toBe('string')
      for (const f of c.functions) expect(Object.keys(f)).toEqual(expect.arrayContaining(['name', 'syntax', 'description', 'example']))
    }
    expect(QUIZ_ATTEMPTS.length).toBe(2)
  })
})

describe('ids', () => {
  it('every id is a unique fixture UUID', () => {
    const all = [
      WORKSPACE, ...PHASES, ...MILESTONES, ...ASSETS, ...TASKS, ...DEPENDENCIES, ...TASK_LINKS, ...COMMENTS,
      ...ASSET_VERSIONS, ...EDIT_HISTORY, ...TASK_TEMPLATES, ...SCENES, ...SHOTS, ...BINS, ...BIN_FILES, ...BIN_ROOTS,
      ...SHOT_TAKES, ...FOLDERS, ...FILES, ...FILE_EVENTS, ...RATE_CARDS, ...RATE_CARD_ENTRIES, ...BUDGET_LINES,
      ...BUDGET_ACTUALS, ...BUDGET_VERSIONS, ...EXPENSES, ...PROJECT_RATE_OVERRIDES, ...NOTES, ...NOTE_SUBJECTS,
      COURSE, ...SUBJECTS, ...QUIZ_ATTEMPTS, PROJECT,
    ].map((r) => r.id).concat(MEMBERS.map((m) => m.user_id))
    expect(all.length).toBeGreaterThan(250)
    expect(new Set(all).size).toBe(all.length)
    for (const id of all) {
      expect(id, id).toMatch(UUID)
      expect(id.startsWith(FIXTURE_ID_PREFIX), id).toBe(true)
    }
  })
})
