// =============================================================================
// boardsFixtures.js — MO4 (migrations 0130 to 0133): boards on the fake cloud.
//
// The board methods of rabbitFixturesAdapter.js, kept in memory beside the
// store (store.boardsFx: boards, elements, sticky turns and the stickies'
// words), answering what the database answers and refusing what it refuses,
// in its words and with its codes: board_create, board_read (paged as 0130
// pages it), board_read_elements, board_put_elements, board_delete_elements,
// board_channels, the sticky turn (0133) and the sticky's save, 0131's
// folder trash and moves, and board_set_background (0136). A refusal of a whole statement writes nothing, as a
// transaction rolls back.
//
// The channels are an in-process bus, one for the whole page (module scope),
// so two fixture people on one store (two adapters, `?as=`) hear each other:
// the database's channel carries `elements`, `sticky`, `board` and AUDIENCE as
// 0132, 0133 and 0136 send them (wire elements: no file, has_file, nothing long past 4 KB);
// the live channel carries the people's broadcasts (self off) and presence.
// A join is refused (CHANNEL_ERROR) for a name the person may not read, or one
// the board has moved on from.
//
// The cloud adapter's own rules are restated here, as the fixtures restate
// what they need (devFixtures.test.js allow-lists what src/dev may import):
// what a save sends (boardElementsForSave) and a sticky's file name.
// boardsFixtures.test.js holds the two copies equal and every word here to the
// SQL's.
// =============================================================================

import { MONEY_SEGMENTS, moneyFolderChainLocked } from '../../tools/rabbit_v0.1.0/storage/index'
import { clone, newId, now } from './store'

const KINDS = ['shape', 'connector', 'frame', 'pen', 'text', 'sticky', 'media', 'embed']
const SHAPES = ['rectangle', 'rounded_rectangle', 'circle', 'oval', 'triangle', 'diamond', 'star', 'hexagon', 'arrow',
  'double_arrow', 'speech_bubble', 'process', 'decision', 'document', 'database', 'terminator', 'input_output',
  'predefined_process', 'connector_circle']
const ANCHORS = ['auto', 'top', 'right', 'bottom', 'left', 'center']
const FILE_KINDS = ['sticky', 'media', 'embed']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/
const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/
const TURN_MS = 30000
const DAY_MS = 86400000

// The database's words, each as 0130 to 0133 raise it (boardsFixtures.test.js finds each in the SQL).
export const BOARD_WORDS = Object.freeze({
  boardNotFound: 'board not found',
  boardNotWritable: 'board not found or not writable',
  folderNotWritable: 'folder not found or not writable',
  stickyWords: 'A sticky\'s words live in its file.',
  needsFile: 'A sticky, a picture or an embed needs its file.',
  fileNotFound: 'file not found',
  ownFolder: 'A sticky or a dropped file lives in the board\'s own folder.',
  markdown: 'A sticky is a markdown note.',
  oneSticky: 'This note is already a sticky on its board.',
  style: 'That style is not one a board knows.',
  points: 'Those points are not a drawing a board knows.',
  nameLength: 'A board\'s name is at most 120 characters.',
  entityChain: 'A board is made in the project\'s own folders, not inside a shot\'s, a scene\'s or an asset\'s.',
  projectBoards: 'A project holds at most 500 boards.',
  keptName: 'That name is kept for the project\'s own folders.',
  namesHere: 'Too many folders of that name here.',
  readCount: 'One to 50 elements a read.',
  nothing: 'Nothing to save.',
  saveCount: 'At most 500 elements a save.',
  notObject: 'An element is an object.',
  boardCount: 'A board holds at most 5,000 elements.',
  boardBytes: 'A board holds at most 64 MB of drawing and words.',
  removeShape: 'At most 500 elements a removal, each with its version when versions are sent.',
  boardDeleted: 'A board goes to the trash; it is not deleted here.',
  stickyNotWritable: 'sticky not found or not writable',
  window: 'A window names itself with 8 to 64 letters, digits, - or _.',
  turnEnded: 'Someone else is writing in this sticky now, or your turn ended: your words were not saved.',
  leftBoard: 'This note has left its board: it is edited where it is now.',
  s3Off: 'A sticky\'s words cannot be saved on the company\'s own storage yet.',
  badKey: 'That is not a place this sticky\'s words can be kept.',
  foldersCount: 'One to 50 folders a time.',
  trashDeep: 'A folder with more than 2,000 folders below it cannot go to the trash in one step.',
  layout: 'This folder is part of the project\'s own layout and stays.',
  officeTrash: 'A folder holding files on the office server cannot go to the trash yet.',
  tooManyFiles: 'More than 10,000 files would go at once.',
  parentTrashed: 'The folder this one was in is in the trash too: bring that back first.',
  crossProject: 'A board or folder stays in its project for now: move its files with Move to.',
  intoItself: 'A folder cannot go inside itself.',
  moveDeep: 'A folder with more than 2,000 folders below it cannot move in one step.',
  holdsLayout: 'This folder holds part of the project\'s own layout and stays.',
  boardEntity: 'A board stays in the project\'s own folders, not inside a shot\'s, a scene\'s or an asset\'s.',
  officeMove: 'A folder holding files on the office server cannot move yet.',
  namesThere: 'Too many folders of that name there.',
})
const W = BOARD_WORDS
// 0136's words for a background it does not know (board_set_background raises them with 22023). Kept apart from
// BOARD_WORDS, which are each found in 0130 to 0133; boardsFixtures.test.js finds these in 0136 once it is there.
export const BACKGROUND_WORDS = 'A board\'s background is dotted, blank or lined.'
const BACKGROUNDS = ['dots', 'blank', 'lines']
// The cloud adapter's own words (supabaseAdapter.js), restated.
export const FIXTURE_STICKY_GONE = 'This note is missing — it may have been moved or deleted.'
export const FIXTURE_STICKY_MOVED = 'Someone changed this sticky since you opened it, so your words were not saved.'
export const FIXTURE_FILE_GONE = 'This file is missing — it may have been moved or deleted.'

// A refusal as the cloud adapter hands one on: the code and the words; a P0001 with words is its code word and them.
function pgError(code, words, detail = null) {
  const err = new Error(detail ?? words)
  err.code = detail ? words : code
  return err
}
const checkError = (name) => pgError('23514', `new row for relation "board_elements" violates check constraint "${name}"`)

// ── The cloud adapter's rules, restated (boardsFixtures.test.js holds them equal) ─────────────────────────────
const BOARD_SERVER_KEYS = ['file', 'missing', 'version', 'updated_at', 'updated_by', 'created_at', 'created_by',
  'has_file', 'points_omitted', 'board_id', 'project_id', 'workspace_id', 'bytes']
export function fixtureBoardElementsForSave(elements) {
  const rows = []
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) { rows.push(el); continue }
    const row = { ...el }
    if (row.file_id === undefined && row.file && typeof row.file === 'object' && row.file.id) row.file_id = row.file.id
    if (row.points_omitted === true) {
      if (row.points == null) delete row.points
      if (row.body == null) delete row.body
    }
    for (const k of BOARD_SERVER_KEYS) delete row[k]
    rows.push(row)
  }
  return [...rows.filter(r => r?.kind !== 'connector'), ...rows.filter(r => r?.kind === 'connector')]
}
export function fixtureStickyFileName(text) {
  const line = String(text ?? '').split(/\r?\n/).map(s => s.replace(/^[\s#>*+-]+/, '').trim()).find(Boolean) || ''
  const name = line.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
  return `${name || 'Sticky note'}.md`
}

// ── The page's one bus ───────────────────────────────────────────────────────────────────────────────────────
const BUS = new Map()
const PRESENCE = Symbol('presence')
function busSubs(topic) {
  let subs = BUS.get(topic)
  if (!subs) { subs = new Set(); BUS.set(topic, subs) }
  return subs
}
function busSay(topic, event, payload, from = null) {
  const subs = BUS.get(topic)
  if (!subs) return
  for (const sub of [...subs]) {
    if (sub === from) continue
    const copy = clone(payload)
    queueMicrotask(() => sub.deliver(event, copy))
  }
}
function presenceSync(topic) {
  const subs = BUS.get(topic)
  if (!subs) return
  const seen = new Set()
  const people = []
  for (const s of subs) {
    if (!s.meta || seen.has(s.userId)) continue
    seen.add(s.userId)
    people.push({ key: s.userId, ...s.meta })
  }
  busSay(topic, PRESENCE, people)
}

// ── Small rules ──────────────────────────────────────────────────────────────────────────────────────────────
const tryUuid = (v) => (typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null)
const utf8Bytes = (s) => (s == null ? 0 : new TextEncoder().encode(String(s)).length)
// points::text as jsonb prints an array of numbers.
const pointsText = (p) => (p == null ? '' : Array.isArray(p) ? `[${p.map(v => JSON.stringify(v)).join(', ')}]` : JSON.stringify(p))
const elementBytes = (e) => utf8Bytes(pointsText(e.points)) + utf8Bytes(e.body)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byStack = (a, b) => (a.z - b.z) || byId(a, b)

function styleOk(kind, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return false
  for (const [k, v] of Object.entries(style)) {
    if (['fill', 'stroke', 'colour', 'text_colour'].includes(k)) {
      if (typeof v !== 'string' || !(HEX_RE.test(v) || v === 'none')) return false
    } else if (k === 'dash') {
      if (!['solid', 'dashed', 'dotted'].includes(v)) return false
    } else if (k === 'width') {
      if (!isNum(v) || v < 0 || v > 40) return false
    } else if (k === 'opacity') {
      if (!isNum(v) || v < 0 || v > 1) return false
    } else if (k === 'font_size') {
      if (!isNum(v) || v < 6 || v > 400) return false
    } else if (k === 'align') {
      if (!['left', 'center', 'right'].includes(v)) return false
    } else if (k === 'route' && kind === 'connector') {
      if (!['straight', 'curved', 'elbow'].includes(v)) return false
    } else if ((k === 'start_head' || k === 'end_head') && kind === 'connector') {
      if (!['none', 'arrow', 'open_arrow', 'dot', 'diamond'].includes(v)) return false
    } else if (k === 'corner' && ['shape', 'frame', 'sticky', 'media', 'embed'].includes(kind)) {
      if (!isNum(v) || v < 0 || v > 1000) return false
    } else {
      return false
    }
  }
  return true
}
function pointsOk(kind, points) {
  if (points == null) return kind !== 'pen'
  if (kind !== 'pen' && kind !== 'connector') return false
  if (!Array.isArray(points) || points.length % 2 !== 0) return false
  if (points.length > (kind === 'pen' ? 20000 : 128)) return false
  if (kind === 'pen' && points.length < 2) return false
  return points.every(v => isNum(v) && Math.abs(v) <= 10000000)
}
// A cast as Postgres makes it: a number, or its text; else 22P02 in its words.
function castNumber(v, type) {
  if (v === undefined || v === null) return undefined
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (typeof v === 'boolean' || typeof v === 'object' || Number.isNaN(n) || (typeof v === 'string' && v.trim() === '')
    || (type === 'bigint' && !Number.isInteger(n))) {
    throw pgError('22P02', `invalid input syntax for type ${type}: "${typeof v === 'object' ? JSON.stringify(v) : String(v)}"`)
  }
  return n
}
const asText = (v) => (v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v))
// A uuid[] argument, cast whole: one id that is not one refuses the call.
function uuidArray(list) {
  return list.map((v) => {
    const id = tryUuid(asText(v))
    if (!id) throw pgError('22P02', `invalid input syntax for type uuid: "${asText(v)}"`)
    return id
  })
}

export function createBoardsFixtures(store, ctx) {
  const { userId, workspaceId, projectOf, mothTargetVisible, mothMayChange, mothProjectWritable, mothProjectVisible, isMoneyFile } = ctx
  const fileUrlOf = typeof ctx.fileUrl === 'function' ? ctx.fileUrl : async () => null
  const S = () => {
    if (!store.boardsFx) store.boardsFx = { boards: [], elements: [], locks: [], texts: new Map(), generation: 0 }
    return store.boardsFx
  }
  // The key each sticky's words were last read from, this person's (the cloud adapter keeps the same).
  const stickyKeys = new Map()
  const folderOf = (id) => store.folders.find(f => f.id === id) || null
  const label = (uid) => {
    const m = (store.members || []).find(x => x.user_id === uid)
    if (!m) return null
    const name = String(m.display_name ?? '').trim() || m.username
    return name ? String(name).slice(0, 80) : 'Someone'
  }
  const boardRow = (id) => S().boards.find(b => b.id === id && b.workspace_id === workspaceId) || null
  // rabbit_private.board_for: the board a caller may read (or write), or nothing.
  const boardFor = (id, write) => {
    const b = boardRow(id)
    if (!b || !mothTargetVisible('folder', b.folder_id)) return null
    if (write && !mothMayChange('folder', b.folder_id)) return null
    return b
  }
  const elementsOf = (boardId) => S().elements.filter(e => e.board_id === boardId)
  const epochOf = (b) => Number(projectOf(b.project_id)?.topic_epoch) || 0
  const topicName = (b, live, gen = b.audience_gen) => `${live ? 'moth:board-live:' : 'moth:board:'}${b.id}:${epochOf(b)}.${gen}`
  // board_topic_readable.
  const topicReadable = (topic) => {
    const parts = String(topic ?? '').split(':')
    if (parts.length !== 4 || parts[0] !== 'moth' || !['board', 'board-live'].includes(parts[1])) return false
    const b = boardRow(tryUuid(parts[2]))
    return !!b && parts[3] === `${epochOf(b)}.${b.audience_gen}` && mothTargetVisible('folder', b.folder_id)
  }
  // rabbit_private.board_element_json: a file the reader may not see, or one gone, is the stop-sign tile.
  const elementJson = (e) => {
    let file = null
    let missing = false
    if (FILE_KINDS.includes(e.kind)) {
      const f = e.file_id ? store.files.find(x => x.id === e.file_id) : null
      if (f && mothTargetVisible('file', f.id)) {
        file = { id: f.id, name: String(f.name ?? '').slice(0, 300), mime_type: f.mime_type ?? null, folder_id: f.folder_id ?? null, project_id: f.project_id }
      }
      missing = file === null
    }
    return clone({
      id: e.id, kind: e.kind, shape: e.shape, x: e.x, y: e.y, w: e.w, h: e.h, rotation: e.rotation, z: e.z,
      style: e.style, body: e.body, points: e.points, file, missing,
      from_id: e.from_id, from_anchor: e.from_anchor, to_id: e.to_id, to_anchor: e.to_anchor,
      version: e.version, updated_at: e.updated_at, updated_by: e.updated_by,
    })
  }
  // rabbit_private.board_element_wire (0132).
  const wire = (e) => clone({
    id: e.id, kind: e.kind, shape: e.shape, x: e.x, y: e.y, w: e.w, h: e.h, rotation: e.rotation, z: e.z,
    style: e.style, body: e.bytes <= 4096 ? e.body : null, points: e.bytes <= 4096 ? e.points : null,
    points_omitted: e.bytes > 4096, has_file: FILE_KINDS.includes(e.kind),
    from_id: e.from_id, from_anchor: e.from_anchor, to_id: e.to_id, to_anchor: e.to_anchor,
    version: e.version, updated_by: e.updated_by,
  })
  // rabbit_private.board_announce: one message a statement, 25 elements or 200 ids a message, in id order.
  const announce = (b, op, ids) => {
    const set = new Set(ids)
    if (!set.size) return
    const topic = topicName(b, false)
    if (op === 'remove') {
      const sorted = [...set].sort()
      for (let i = 0; i < sorted.length; i += 200) busSay(topic, 'elements', { board: b.id, op: 'remove', ids: sorted.slice(i, i + 200) })
      return
    }
    const els = elementsOf(b.id).filter(e => set.has(e.id)).sort(byId)
    for (let i = 0; i < els.length; i += 25) busSay(topic, 'elements', { board: b.id, op: 'put', elements: els.slice(i, i + 25).map(wire) })
  }
  const stickySay = (b, payload) => busSay(topicName(b, false), 'sticky', { ...payload, board: b.id })
  // fn_boards_audience_moved: the old names hear AUDIENCE, on both channels.
  const audienceMoved = (b) => {
    const old = b.audience_gen
    b.audience_gen += 1
    for (const live of [false, true]) busSay(topicName(b, live, old), 'AUDIENCE', { board: b.id, op: 'audience' })
  }
  const boardJson = (b) => ({
    id: b.id, folder_id: b.folder_id, project_id: b.project_id, title: folderOf(b.folder_id)?.label ?? null,
    revision: b.revision, audience_gen: b.audience_gen, can_write: !!mothMayChange('folder', b.folder_id),
    // 0136: the columns' defaults fill a board made before them.
    background: b.background ?? 'dots',
    background_version: b.background_version ?? 0,
  })
  // rabbit_private.folder_chain_has_entity.
  const chainHasEntity = (folderId) => {
    let node = folderOf(folderId)
    for (let depth = 1; node && depth <= 64; depth += 1) {
      if (node.kind === 'entity') return true
      node = node.parent_id ? folderOf(node.parent_id) : null
    }
    return false
  }
  // rabbit_private.folder_subtree: itself first, then by depth and id.
  const subtree = (folderId) => {
    const out = []
    let level = [folderId]
    for (let depth = 1; level.length && depth <= 64 && out.length <= 2000; depth += 1) {
      out.push(...[...level].sort())
      const ids = new Set(level)
      level = store.folders.filter(f => ids.has(f.parent_id)).map(f => f.id)
    }
    return out.slice(0, 2001)
  }
  const isMoneySeg = (seg) => typeof seg === 'string' && MONEY_SEGMENTS.includes(seg.toUpperCase())
  // _moth_target_eligible('folder', id, true): a folder in the trash, read as a definer reads it.
  const folderEligibleTrashed = (f) => !!f && f.workspace_id === workspaceId && mothProjectVisible(projectOf(f.project_id))
    && !moneyFolderChainLocked(f.id, store.folders.filter(x => x.project_id === f.project_id))
  const lockLive = (l, at) => l.expires_at > at
  const stickyFor = (elementId) => {
    const e = S().elements.find(x => x.id === elementId && x.kind === 'sticky')
    if (!e) return null
    return boardFor(e.board_id, true) ? e : null
  }

  // board_put_elements: one statement, so a refusal anywhere writes nothing.
  function putElements(boardId, list) {
    const b = boardFor(boardId, true)
    if (!b) throw pgError('42501', W.boardNotWritable)
    if (!Array.isArray(list) || list.length === 0) throw pgError('22023', W.nothing)
    if (list.length > 500) throw pgError('54000', W.saveCount)
    const work = new Map(elementsOf(b.id).map(e => [e.id, clone(e)]))
    const everyId = new Set(S().elements.map(e => e.id))
    const folderId = b.folder_id
    const saved = []
    const conflicts = []
    let added = 0
    const at = now()
    for (const el of list) {
      if (!el || typeof el !== 'object' || Array.isArray(el)) throw pgError('22023', W.notObject)
      let id = tryUuid(asText(el.id))
      let asked = null
      if (!id) id = crypto.randomUUID()
      const old = work.get(id) || null
      if (!old && everyId.has(id)) { asked = id; id = crypto.randomUUID() }
      // A key the wire carries (one whose value is undefined is not sent).
      const has = (k) => Object.prototype.hasOwnProperty.call(el, k) && el[k] !== undefined
      let row
      if (old) {
        if (has('expect') && (el.expect === null || castNumber(el.expect, 'bigint') !== old.version)) {
          conflicts.push({ id, version: old.version })
          continue
        }
        row = { ...old }
        if (has('shape')) row.shape = asText(el.shape)
        for (const k of ['x', 'y', 'w', 'h', 'rotation']) { const v = castNumber(el[k], 'double precision'); if (v !== undefined) row[k] = v }
        { const v = castNumber(el.z, 'bigint'); if (v !== undefined) row.z = v }
        if (has('style')) row.style = el.style === undefined ? {} : clone(el.style)
        if (has('body')) row.body = asText(el.body)
        if (has('points')) row.points = el.points === null ? null : clone(el.points)
        if (has('from_id')) row.from_id = tryUuid(asText(el.from_id))
        if (has('from_anchor')) row.from_anchor = asText(el.from_anchor)
        if (has('to_id')) row.to_id = tryUuid(asText(el.to_id))
        if (has('to_anchor')) row.to_anchor = asText(el.to_anchor)
        // fn_board_elements_guard, an update.
        if (row.kind === 'sticky' && row.body != null) throw pgError('22023', W.stickyWords)
        row.version = old.version + 1
        row.updated_at = at
        row.updated_by = userId
      } else {
        if (has('expect') && (el.expect === null || castNumber(el.expect, 'bigint') !== 0)) {
          conflicts.push({ id: asked ?? id, version: null })
          continue
        }
        const num = (k, type) => castNumber(el[k], type) ?? 0
        row = {
          id, board_id: b.id, project_id: b.project_id, workspace_id: b.workspace_id,
          kind: asText(el.kind), shape: asText(el.shape),
          x: num('x', 'double precision'), y: num('y', 'double precision'), w: num('w', 'double precision'),
          h: num('h', 'double precision'), rotation: num('rotation', 'double precision'), z: num('z', 'bigint'),
          style: el.style === undefined ? {} : clone(el.style), body: asText(el.body),
          points: Array.isArray(el.points) ? clone(el.points) : null,
          file_id: tryUuid(asText(el.file_id)),
          from_id: tryUuid(asText(el.from_id)), from_anchor: asText(el.from_anchor),
          to_id: tryUuid(asText(el.to_id)), to_anchor: asText(el.to_anchor),
          version: 1, created_at: at, created_by: userId, updated_at: at, updated_by: userId,
        }
        // fn_board_elements_guard, an insert.
        if (row.kind === 'sticky' && row.body != null) throw pgError('22023', W.stickyWords)
        if (FILE_KINDS.includes(row.kind) && !row.file_id) throw pgError('22023', W.needsFile)
        if (row.file_id) {
          if (!mothTargetVisible('file', row.file_id)) throw pgError('42501', W.fileNotFound)
          const f = store.files.find(x => x.id === row.file_id)
          if ((row.kind === 'sticky' || row.kind === 'media') && f.folder_id !== folderId) throw pgError('22023', W.ownFolder)
          if (row.kind === 'sticky') {
            if (!(f.mime_type === 'text/markdown' || String(f.name ?? '').toLowerCase().endsWith('.md'))) throw pgError('22023', W.markdown)
            const twice = [...S().elements.filter(x => x.board_id !== b.id), ...work.values()].some(x => x.file_id === row.file_id
              && x.kind === 'sticky' && boardRow(x.board_id)?.folder_id === f.folder_id)
            if (twice) throw pgError('23505', W.oneSticky)
          }
        }
      }
      if (!styleOk(row.kind, row.style)) throw pgError('22023', W.style)
      if (!pointsOk(row.kind, row.points)) throw pgError('22023', W.points)
      row.bytes = elementBytes(row)
      // NOT NULL, then the CHECKs in their names' order, as Postgres asks them.
      if (row.kind == null) throw pgError('23502', 'null value in column "kind" of relation "board_elements" violates not-null constraint')
      if ((row.from_anchor != null && !ANCHORS.includes(row.from_anchor)) || (row.to_anchor != null && !ANCHORS.includes(row.to_anchor))) throw checkError('board_elements_anchor_chk')
      if (row.body != null && [...row.body].length > 10000) throw checkError('board_elements_body_chk')
      if (row.kind !== 'connector' && (row.from_id || row.to_id || row.from_anchor != null || row.to_anchor != null)) throw checkError('board_elements_ends_kind_chk')
      if (row.file_id && !FILE_KINDS.includes(row.kind)) throw checkError('board_elements_file_kind_chk')
      const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi
      if (!(inRange(row.x, -1e7, 1e7) && inRange(row.y, -1e7, 1e7) && inRange(row.w, 0, 1e6) && inRange(row.h, 0, 1e6) && inRange(row.rotation, -360, 360))) throw checkError('board_elements_geometry_chk')
      if (!KINDS.includes(row.kind)) throw checkError('board_elements_kind_chk')
      if (row.from_id === row.id || row.to_id === row.id) throw checkError('board_elements_not_self_chk')
      if (row.points != null && utf8Bytes(pointsText(row.points)) > 262144) throw checkError('board_elements_points_chk')
      if ((row.kind === 'shape') !== (row.shape != null) || (row.shape != null && !SHAPES.includes(row.shape))) throw checkError('board_elements_shape_chk')
      if (utf8Bytes(JSON.stringify(row.style)) > 4096) throw checkError('board_elements_style_chk')
      // The ends' keys, at the end of the element's own statement: an end of this board, there already.
      for (const [col, key] of [['from_id', 'board_elements_from_fk'], ['to_id', 'board_elements_to_fk']]) {
        if (row[col] && row[col] !== row.id && !work.has(row[col])) {
          throw pgError('23503', `insert or update on table "board_elements" violates foreign key constraint "${key}"`)
        }
      }
      if (!old) { added += 1; everyId.add(row.id) }
      work.set(row.id, row)
      saved.push({ id: row.id, version: row.version, ...(asked ? { asked } : {}) })
    }
    if (added > 0 && work.size > 5000) throw pgError('54000', W.boardCount)
    if (saved.length > 0 && [...work.values()].reduce((n, e) => n + e.bytes, 0) > 67108864) throw pgError('54000', W.boardBytes)
    if (!saved.length) return { saved, conflicts }
    S().elements = [...S().elements.filter(e => e.board_id !== b.id), ...work.values()]
    b.revision += 1
    b.updated_at = at
    b.updated_by = userId
    announce(b, 'put', saved.map(s => s.id))
    return { saved, conflicts }
  }

  // A medium or an embed placed as the cloud adapter places one: put, then the element as board_read gives it.
  function placeFile(b, kind, fileId, placement) {
    const p = placement || {}
    const el = {
      id: p.id || crypto.randomUUID(), kind, file_id: fileId,
      x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 240, h: p.h ?? 180, rotation: p.rotation ?? 0, z: p.z ?? 0,
      ...(p.style ? { style: p.style } : {}),
    }
    const saved = putElements(b.id, fixtureBoardElementsForSave([el]))?.saved?.[0]
    if (!saved) throw pgError('42501', W.boardNotWritable)
    return elementJson(S().elements.find(x => x.id === saved.id))
  }

  // board_delete_elements.
  function deleteElements(boardId, rawIds, versions) {
    const ids = uuidArray(rawIds)
    const b = boardFor(boardId, true)
    if (!b) throw pgError('42501', W.boardNotWritable)
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || (versions != null && (!Array.isArray(versions) || versions.length !== ids.length))) {
      throw pgError('22023', W.removeShape)
    }
    const removed = []
    const conflicts = []
    const ends = new Set()
    const at = now()
    ids.forEach((id, i) => {
      const e = S().elements.find(x => x.id === id && x.board_id === b.id)
      if (!e) return
      if (versions != null && versions[i] !== e.version) { conflicts.push({ id, version: e.version }); return }
      for (const c of elementsOf(b.id)) {
        if (c.from_id === id || c.to_id === id) ends.add(c.id)
      }
      S().elements = S().elements.filter(x => x !== e)
      S().locks = S().locks.filter(l => l.element_id !== id)
      // The ends' ON DELETE SET NULL, which the guard counts a version.
      for (const c of elementsOf(b.id)) {
        let changed = false
        if (c.from_id === id) { c.from_id = null; changed = true }
        if (c.to_id === id) { c.to_id = null; changed = true }
        if (changed) { c.version += 1; c.updated_at = at }
      }
      removed.push(id)
    })
    if (removed.length) {
      b.revision += 1
      b.updated_at = at
      b.updated_by = userId
      announce(b, 'remove', removed)
      announce(b, 'put', [...ends].filter(x => !removed.includes(x)))
    }
    return { removed, conflicts }
  }

  // board_read, one page: at most 2,000 elements and 8 MB a page.
  function readPage(boardId, after) {
    const b = boardFor(boardId, false)
    if (!b) throw pgError('42501', W.boardNotFound)
    const rows = elementsOf(b.id).sort(byStack)
      .filter(e => !after || e.z > after.z || (e.z === after.z && e.id > after.id))
    const out = []
    let bytes = 0
    let next = null
    for (const e of rows) {
      const size = e.bytes + 256
      if (out.length > 0 && (out.length >= 2000 || bytes + size > 8388608)) {
        const last = out[out.length - 1]
        next = { z: last.z, id: last.id }
        break
      }
      out.push(e)
      bytes += size
    }
    return { board: boardJson(b), elements: out.map(elementJson), next, truncated: next !== null }
  }

  // moth_trash_folders.
  function trashFolders(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))]
      .sort((a, b) => (String(folderOf(a)?.path ?? '').split('/').length - String(folderOf(b)?.path ?? '').split('/').length) || (a < b ? -1 : a > b ? 1 : 0))
    if (list.length === 0 || list.length > 50) throw pgError('22023', W.foldersCount)
    const roots = []
    const all = new Set()
    for (const id of list) {
      const f = folderOf(id)
      if (!f || f.workspace_id !== workspaceId || !mothMayChange('folder', id)) throw pgError('42501', W.folderNotWritable)
      if (all.has(id)) continue
      const sub = subtree(id)
      if (sub.length > 2000) throw pgError('54000', W.trashDeep)
      if (sub.some(x => folderOf(x)?.kind !== 'custom')) throw pgError('22023', W.layout)
      const set = new Set(sub)
      if (store.files.some(x => set.has(x.folder_id) && !x.deleted_at && x.storage_provider === 'network_share' && !isMoneyFile(x))) {
        throw pgError('22023', W.officeTrash)
      }
      for (const x of sub) all.add(x)
      roots.push({ root: id, sub })
    }
    const below = store.files.filter(x => all.has(x.folder_id) && !x.deleted_at)
    if (below.length > 10000) throw pgError('54000', W.tooManyFiles)
    // A money or Legal file below goes to the project's top folder, and nothing says it was there.
    for (const x of below) if (isMoneyFile(x)) x.folder_id = null
    const at = now()
    let dirs = 0
    for (const r of roots) {
      const batch = crypto.randomUUID()
      for (const x of r.sub) {
        const f = folderOf(x)
        if (f && !f.deleted_at) { Object.assign(f, { deleted_at: at, deleted_by: userId, trash_batch: batch }); dirs += 1 }
      }
    }
    let files = 0
    for (const x of store.files) {
      if (all.has(x.folder_id) && !x.deleted_at) {
        Object.assign(x, { deleted_at: at, trash_batch: folderOf(x.folder_id)?.trash_batch ?? null })
        files += 1
      }
    }
    for (const b of S().boards) if (all.has(b.folder_id)) audienceMoved(b)
    return { batches: roots.length, folders: dirs, files }
  }

  // moth_restore_folders.
  function restoreFolders(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))].sort()
    if (list.length === 0 || list.length > 50) throw pgError('22023', W.foldersCount)
    const back = new Set()
    let dirs = 0
    let files = 0
    for (const id of list) {
      if (back.has(id)) continue
      const f = folderOf(id)
      if (!f || f.workspace_id !== workspaceId || !f.deleted_at || !f.trash_batch
        || Date.parse(f.deleted_at) < Date.now() - 30 * DAY_MS || !folderEligibleTrashed(f)
        || !mothProjectWritable(projectOf(f.project_id))) {
        throw pgError('42501', W.folderNotWritable)
      }
      const parent = f.parent_id ? folderOf(f.parent_id) : null
      if (parent?.deleted_at && parent.trash_batch !== f.trash_batch) throw pgError('22023', W.parentTrashed)
      const batch = f.trash_batch
      for (const x of store.folders) {
        if (x.trash_batch === batch) { back.add(x.id); Object.assign(x, { deleted_at: null, deleted_by: null, trash_batch: null }); dirs += 1 }
      }
      for (const x of store.files) {
        if (x.trash_batch === batch) { Object.assign(x, { deleted_at: null, trash_batch: null }); files += 1 }
      }
    }
    return { folders: dirs, files }
  }

  // moth_trashed_folders: each batch by the folder it was put in the trash from, newest first.
  function trashedFolders({ limit = 200, before = null, beforeId = null } = {}) {
    const cap = Math.min(Math.max(Number(limit) || 200, 1), 500)
    const out = []
    const rows = store.folders.filter(f => f.workspace_id === workspaceId && f.trash_batch && f.deleted_at
      && Date.parse(f.deleted_at) > Date.now() - 30 * DAY_MS)
      .filter(f => {
        if (!before) return true
        const t = Date.parse(f.deleted_at)
        const bt = Date.parse(before)
        return t < bt || (t === bt && f.id < (beforeId ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
      })
      .filter(f => { const p = projectOf(f.project_id); return p && !p.deleted_at && (!p.personal_owner_id || p.personal_owner_id === userId) })
      .filter(f => { const par = f.parent_id ? folderOf(f.parent_id) : null; return !(par && par.trash_batch === f.trash_batch) })
      .sort((a, b) => (Date.parse(b.deleted_at) - Date.parse(a.deleted_at)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    for (const f of rows) {
      if (out.length >= cap) break
      if (!folderEligibleTrashed(f)) continue
      const who = (store.members || []).find(m => m.user_id === f.deleted_by)
      out.push({
        id: f.id, project_id: f.project_id, project_title: projectOf(f.project_id)?.title ?? null, name: f.label || f.slug,
        is_board: S().boards.some(b => b.folder_id === f.id),
        files: store.files.filter(x => x.trash_batch === f.trash_batch).length,
        deleted_at: f.deleted_at, deleted_by_label: who ? (who.display_name || who.username) : null,
        purges_at: new Date(Date.parse(f.deleted_at) + 30 * DAY_MS).toISOString(),
        can_restore: !!mothProjectWritable(projectOf(f.project_id)),
      })
    }
    return clone(out)
  }

  // moth_move_folders: one statement, so a refusal of a later folder puts the earlier ones back.
  function moveFolders(ids, destParent, planOnly) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))].sort()
    if (list.length === 0 || list.length > 50) throw pgError('22023', W.foldersCount)
    const dest = folderOf(destParent)
    if (!dest || dest.workspace_id !== workspaceId || !mothMayChange('folder', destParent)) throw pgError('42501', W.folderNotWritable)
    const before = store.folders.map(f => clone(f))
    const plan = []
    try {
      for (const id of list) {
        const src = folderOf(id)
        if (!src || src.workspace_id !== workspaceId || !mothMayChange('folder', id)) throw pgError('42501', W.folderNotWritable)
        if (src.kind !== 'custom') throw pgError('22023', W.layout)
        if (src.project_id !== dest.project_id) throw pgError('P0001', 'cross_project', W.crossProject)
        const sub = subtree(id)
        if (sub.includes(destParent)) throw pgError('22023', W.intoItself)
        if (sub.length > 2000) throw pgError('54000', W.moveDeep)
        if (sub.some(x => folderOf(x)?.kind !== 'custom')) throw pgError('22023', W.holdsLayout)
        if (S().boards.some(b => sub.includes(b.folder_id)) && chainHasEntity(destParent)) throw pgError('22023', W.boardEntity)
        const set = new Set(sub)
        if (store.files.some(x => set.has(x.folder_id) && !x.deleted_at && x.storage_provider === 'network_share' && !isMoneyFile(x))) {
          throw pgError('22023', W.officeMove)
        }
        if (dest.kind === 'root' && isMoneySeg(src.slug)) throw pgError('22023', W.keptName)
        if (src.parent_id === destParent) {
          plan.push({ id, from: src.path, to: src.path, folders: sub.length })
          continue
        }
        let slug = src.slug
        let to = null
        for (let n = 1; ; ) {
          to = dest.path === '' ? slug : `${dest.path}/${slug}`
          if (!store.folders.some(x => x.project_id === dest.project_id && x.path === to)) break
          n += 1
          slug = `${String(src.slug).slice(0, 60)}-${n}`
          if (n > 200) throw pgError('23505', W.namesThere)
        }
        plan.push({ id, from: src.path, to, folders: sub.length })
        if (planOnly) continue
        const fromPath = src.path
        for (const x of sub) {
          const f = folderOf(x)
          if (f.id === id) { f.parent_id = destParent; f.slug = slug }
          f.path = to + String(f.path).slice(fromPath.length)
          f.updated_by = userId
          f.updated_at = now()
        }
      }
    } catch (err) {
      store.folders.splice(0, store.folders.length, ...before)
      throw err
    }
    return { moved: clone(plan), plan_only: !!planOnly }
  }

  return {
    // ── MO4 (0130 to 0133): boards, as the cloud keeps them ─────────────────────────────────────────────────
    async listBoards(projectId) {
      return clone(S().boards.filter(b => b.project_id === projectId && boardFor(b.id, false)).sort(byId)
        .map(({ id, folder_id, project_id, audience_gen, revision }) => ({ id, folder_id, project_id, audience_gen, revision })))
    },
    // board_create.
    async createBoard(projectId, parentFolderId = null, title = null) {
      let name = String(title ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/^ +| +$/g, '')
      if (name === '') name = 'Board'
      if ([...name].length > 120) throw pgError('22023', W.nameLength)
      const parent = parentFolderId == null
        ? store.folders.find(f => f.project_id === projectId && f.kind === 'root' && f.workspace_id === workspaceId)
        : store.folders.find(f => f.id === parentFolderId && f.project_id === projectId && f.workspace_id === workspaceId)
      if (!parent || !mothMayChange('folder', parent.id)) throw pgError('42501', W.folderNotWritable)
      if (chainHasEntity(parent.id)) throw pgError('22023', W.entityChain)
      if (S().boards.filter(b => b.project_id === projectId).length >= 500) throw pgError('54000', W.projectBoards)
      let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
      if (base === '') base = 'board'
      if (parent.kind === 'root' && isMoneySeg(base)) throw pgError('22023', W.keptName)
      let path = null
      let slug = null
      for (let n = 1; ; n += 1) {
        if (n > 200) throw pgError('23505', W.namesHere)
        slug = n === 1 ? base : `${base}-${n}`
        path = parent.path === '' ? slug : `${parent.path}/${slug}`
        if (!store.folders.some(f => f.project_id === projectId && f.path === path)) break
      }
      const at = now()
      const folder = {
        id: newId(), project_id: projectId, workspace_id: workspaceId, parent_id: parent.id,
        kind: 'custom', entity_type: null, asset_id: null, scene_id: null, shot_id: null, level_id: null, experience_id: null,
        slug, label: name, path, sort_order: store.folders.filter(f => f.project_id === projectId).length,
        created_at: at, created_by: userId, updated_at: at, updated_by: userId,
      }
      store.folders.push(folder)
      if (moneyFolderChainLocked(folder.id, store.folders.filter(f => f.project_id === projectId))) {
        store.folders.splice(store.folders.indexOf(folder), 1)
        throw pgError('42501', W.folderNotWritable)
      }
      const board = {
        id: crypto.randomUUID(), workspace_id: workspaceId, project_id: projectId, folder_id: folder.id,
        audience_gen: 0, revision: 0, background: 'dots', background_version: 0, created_at: at, created_by: userId, updated_at: at, updated_by: userId,
      }
      S().boards.push(board)
      return { board_id: board.id, folder_id: folder.id, project_id: projectId, title: name, path }
    },
    async readBoard(boardId) {
      let board = null
      let after = null
      const elements = []
      for (let page = 0; page < 64; page += 1) {
        const out = readPage(boardId, after)
        if (!board) board = out.board
        elements.push(...out.elements)
        if (!out.next) return { board, elements }
        after = out.next
      }
      throw pgError('54000', 'This board is too large to open.')
    },
    async readBoardElements(boardId, ids) {
      const want = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))]
      if (!want.length) return []
      const out = []
      for (let i = 0; i < want.length; i += 50) {
        const part = uuidArray(want.slice(i, i + 50))
        const b = boardFor(boardId, false)
        if (!b) throw pgError('42501', W.boardNotFound)
        if (part.length === 0 || part.length > 50) throw pgError('22023', W.readCount)
        const set = new Set(part)
        out.push(...elementsOf(b.id).filter(e => set.has(e.id)).sort(byStack).map(elementJson))
      }
      return out.sort(byStack)
    },
    async putBoardElements(boardId, elements) {
      const rows = fixtureBoardElementsForSave(elements)
      const answer = { saved: [], conflicts: [] }
      for (let i = 0; i < rows.length; i += 500) {
        let out
        try {
          out = putElements(boardId, rows.slice(i, i + 500))
        } catch (err) {
          if (answer.saved.length || answer.conflicts.length) err.partial = answer
          throw err
        }
        answer.saved.push(...out.saved)
        answer.conflicts.push(...out.conflicts)
      }
      return clone(answer)
    },
    async deleteBoardElements(boardId, ids, versions = null) {
      const list = Array.isArray(ids) ? ids : []
      if (versions != null && (!Array.isArray(versions) || versions.length !== list.length)) throw pgError('22023', W.removeShape)
      const answer = { removed: [], conflicts: [] }
      for (let i = 0; i < list.length; i += 500) {
        let out
        try {
          out = deleteElements(boardId, list.slice(i, i + 500), versions == null ? null : versions.slice(i, i + 500))
        } catch (err) {
          if (answer.removed.length || answer.conflicts.length) err.partial = answer
          throw err
        }
        answer.removed.push(...out.removed)
        answer.conflicts.push(...out.conflicts)
      }
      return clone(answer)
    },
    async boardChannels(boardId) {
      const b = boardFor(boardId, false)
      if (!b) throw pgError('42501', W.boardNotFound)
      return { topic: topicName(b, false), live_topic: topicName(b, true), audience_gen: b.audience_gen }
    },
    // board_set_background (0136): the board's own field, not an element; revision and audience_gen stay. A change
    // counts one more background_version and is one `board` message on the board's database channel; the same value
    // again changes nothing, says nothing, and answers the version as it is.
    async setBoardBackground(boardId, background) {
      const b = boardFor(boardId, true)
      if (!b) throw pgError('42501', W.boardNotWritable)
      if (typeof background !== 'string' || !BACKGROUNDS.includes(background)) throw pgError('22023', BACKGROUND_WORDS)
      const version = b.background_version ?? 0
      if ((b.background ?? 'dots') === background) return { board_id: b.id, background, version, changed: false }
      b.background = background
      b.background_version = version + 1
      b.updated_at = now()
      b.updated_by = userId
      busSay(topicName(b, false), 'board', { board: b.id, op: 'background', background, version: b.background_version })
      return { board_id: b.id, background, version: b.background_version, changed: true }
    },

    // The sticky's turn (0133), by the clock the page has.
    async claimSticky(elementId, sessionId) {
      const e = stickyFor(elementId)
      if (!e) throw pgError('42501', W.stickyNotWritable)
      if (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId)) throw pgError('22023', W.window)
      const at = Date.now()
      const l = S().locks.find(x => x.element_id === e.id)
      if (l && lockLive(l, at) && !(l.holder === userId && l.holder_session === sessionId)) {
        return { granted: false, holder_label: label(l.holder), ends_in_ms: Math.ceil(l.expires_at - at) }
      }
      if (l && lockLive(l, at)) {
        l.expires_at = at + TURN_MS
        return { granted: true, generation: l.generation, ends_in_ms: TURN_MS }
      }
      S().generation += 1
      const row = { element_id: e.id, board_id: e.board_id, holder: userId, holder_session: sessionId, generation: S().generation, claimed_at: at, expires_at: at + TURN_MS }
      S().locks = [...S().locks.filter(x => x.element_id !== e.id), row]
      stickySay(boardRow(e.board_id), { op: 'lock', element: e.id, holder_label: label(userId), ends_in_ms: TURN_MS })
      return { granted: true, generation: row.generation, ends_in_ms: TURN_MS }
    },
    async renewSticky(elementId, generation) {
      const e = stickyFor(elementId)
      if (!e) throw pgError('42501', W.stickyNotWritable)
      const at = Date.now()
      const l = S().locks.find(x => x.element_id === e.id && x.holder === userId && x.generation === generation && lockLive(x, at))
      if (l) {
        l.expires_at = at + TURN_MS
        stickySay(boardRow(e.board_id), { op: 'renew', element: e.id, holder_label: label(userId), ends_in_ms: TURN_MS })
      }
      return { ok: !!l, ends_in_ms: l ? TURN_MS : 0 }
    },
    async releaseSticky(elementId, generation) {
      const e = S().elements.find(x => x.id === elementId && x.kind === 'sticky' && x.workspace_id === workspaceId)
      if (!e) return false
      const l = S().locks.find(x => x.element_id === e.id && x.holder === userId && x.generation === generation)
      if (!l) return false
      S().locks = S().locks.filter(x => x !== l)
      stickySay(boardRow(e.board_id), { op: 'unlock', element: e.id })
      return true
    },
    async stickyStatus(boardId) {
      const b = boardFor(boardId, false)
      if (!b) throw pgError('42501', W.boardNotFound)
      const at = Date.now()
      return S().locks.filter(l => l.board_id === b.id && lockLive(l, at))
        .sort((x, y) => (x.element_id < y.element_id ? -1 : 1))
        .map(l => ({ element: l.element_id, holder_label: label(l.holder), mine: l.holder === userId, ends_in_ms: Math.ceil(l.expires_at - at) }))
    },
    // The words are the file's: kept here by its key, as a bucket keeps them by name.
    async readStickyText(file) {
      const fileId = typeof file === 'string' ? file : file?.id
      const row = fileId ? store.files.find(f => f.id === fileId) : null
      if (!row || !mothTargetVisible('file', row.id)) throw pgError('42501', FIXTURE_STICKY_GONE)
      stickyKeys.set(row.id, row.storage_path)
      return S().texts.get(row.storage_path) ?? ''
    },
    // board_sticky_publish over the key the words were read from, to a fresh key under the file's own project.
    async saveStickyText(element, generation, text) {
      const fileId = element?.file?.id ?? element?.file_id ?? null
      if (!element?.id || !fileId) throw pgError('42501', FIXTURE_STICKY_GONE)
      const row = store.files.find(f => f.id === fileId)
      if (!row || !mothTargetVisible('file', row.id)) throw pgError('42501', FIXTURE_STICKY_GONE)
      if (row.storage_provider === 's3') throw pgError('P0001', 's3_sticky_off', W.s3Off)
      const from = stickyKeys.get(row.id) ?? row.storage_path
      const to = `projects/${row.project_id}/files/${row.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.md`
      const e = stickyFor(element.id)
      if (!e || !e.file_id) throw pgError('42501', W.stickyNotWritable)
      const at = Date.now()
      const lock = S().locks.find(l => l.element_id === e.id && l.holder === userId && l.generation === generation && lockLive(l, at))
      if (!lock) return { ok: false, reason: 'turn_ended', words: W.turnEnded }
      const f = store.files.find(x => x.id === e.file_id)
      if (!f || f.deleted_at || !mothTargetVisible('file', f.id) || !mothMayChange('file', f.id)) throw pgError('42501', W.stickyNotWritable)
      if (f.folder_id !== boardRow(e.board_id)?.folder_id) throw pgError('22023', W.leftBoard)
      if (f.storage_provider === 's3') throw pgError('P0001', 's3_sticky_off', W.s3Off)
      if (!['supabase', 'local_server'].includes(f.storage_provider)) throw pgError('42501', W.stickyNotWritable)
      // The key read is kept: every save says "moved" until the words are read again.
      if (f.storage_path !== from) return { ok: false, reason: 'moved', words: FIXTURE_STICKY_MOVED }
      if (!to.toLowerCase().endsWith('.md') || to === f.storage_path || store.files.some(x => x.storage_path === to)) throw pgError('42501', W.badKey)
      S().texts.set(to, String(text ?? ''))
      f.storage_path = to
      f.thumbnail_url = null
      f.size_bytes = utf8Bytes(text)
      lock.expires_at = at + TURN_MS
      stickyKeys.set(f.id, to)
      stickySay(boardRow(e.board_id), { op: 'body', element: e.id })
      return { ok: true }
    },
    // A new sticky: a markdown file in the board's own folder (the upload the cloud makes), then placed.
    async createSticky(board, text, placement = {}) {
      const b = board?.id ? boardFor(board.id, true) : null
      if (!b) throw pgError('42501', W.boardNotWritable)
      const words = String(text ?? '')
      const name = fixtureStickyFileName(words)
      const at = now()
      const file = {
        id: newId(), project_id: b.project_id, workspace_id: workspaceId, phase_id: null, asset_id: null, task_id: null,
        scene_id: null, shot_id: null, level_id: null, experience_id: null, folder_id: b.folder_id, name,
        mime_type: 'text/markdown', size_bytes: utf8Bytes(words), storage_provider: 'supabase',
        storage_path: `projects/${b.project_id}/project/${b.project_id}/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`,
        thumbnail_url: null, kind: 'source', is_core_definer: false, is_financial: false, tags: [],
        uploaded_at: at, created_at: at, created_by: userId, updated_at: at, updated_by: userId,
        last_updated_at: at, last_updated_by: userId, deleted_at: null, deleted_by: null,
      }
      store.files.push(file)
      S().texts.set(file.storage_path, words)
      const p = placement || {}
      const el = {
        id: p.id || crypto.randomUUID(), kind: 'sticky', file_id: file.id,
        x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 200, h: p.h ?? 200, rotation: p.rotation ?? 0, z: p.z ?? 0,
        ...(p.style ? { style: p.style } : {}),
      }
      let saved
      try {
        saved = putElements(b.id, [el]).saved[0]
        if (!saved) throw pgError('42501', W.boardNotWritable)
      } catch (err) {
        store.files.splice(store.files.indexOf(file), 1)
        S().texts.delete(file.storage_path)
        throw err
      }
      const back = S().elements.find(x => x.id === saved.id)
      return elementJson(back)
    },
    // A dropped file: a files row in the board's own folder (the upload the cloud makes, so Moth and Files show it),
    // then placed as a medium. A placement the board refuses takes the new file to the trash again.
    async createMedia(board, file, placement = {}) {
      const b = board?.id ? boardFor(board.id, true) : null
      if (!b) throw pgError('42501', W.boardNotWritable)
      if (!file || typeof file !== 'object' || typeof file.size !== 'number') throw pgError('22023', W.needsFile)
      const name = String(file.name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255) || 'File'
      const at = now()
      const row = {
        id: newId(), project_id: b.project_id, workspace_id: workspaceId, phase_id: null, asset_id: null, task_id: null,
        scene_id: null, shot_id: null, level_id: null, experience_id: null, folder_id: b.folder_id, name,
        mime_type: file.type || null, size_bytes: file.size, storage_provider: 'supabase',
        storage_path: `projects/${b.project_id}/project/${b.project_id}/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`,
        thumbnail_url: null, kind: 'source', is_core_definer: false, is_financial: false, tags: [],
        uploaded_at: at, created_at: at, created_by: userId, updated_at: at, updated_by: userId,
        last_updated_at: at, last_updated_by: userId, deleted_at: null, deleted_by: null,
      }
      store.files.push(row)
      try {
        return placeFile(b, 'media', row.id, placement)
      } catch (err) {
        row.deleted_at = now()
        row.deleted_by = userId
        throw err
      }
    },
    // A file the person can see, shown where it is: a reference, no copy. One they may not read is refused as a
    // missing one is (board_put_elements' own words).
    async embedFile(board, fileId, placement = {}) {
      const b = board?.id ? boardFor(board.id, true) : null
      if (!b) throw pgError('42501', W.boardNotWritable)
      const id = typeof fileId === 'string' ? fileId : fileId?.id
      if (!id) throw pgError('22023', W.needsFile)
      return placeFile(b, 'embed', id, placement)
    },
    // A placed file's address: its row read by id as the reader may see it, then what fileUrl answers for that row
    // (null for the fixtures' own files, which have no bodies: the canvas shows the file's tile).
    async boardFileUrl(file, opts = {}) {
      const fileId = typeof file === 'string' ? file : file?.id
      const row = fileId ? store.files.find(f => f.id === fileId) : null
      if (!row || row.deleted_at || !mothTargetVisible('file', row.id)) throw pgError('42501', FIXTURE_FILE_GONE)
      return fileUrlOf(clone(row), { stream: opts?.stream !== false })
    },

    // 0131: a folder's trash and moves, a board's with it.
    async trashFolders(ids) { return trashFolders(ids) },
    async restoreFolders(ids) { return restoreFolders(ids) },
    async listTrashedFolders(opts = {}) { return trashedFolders(opts || {}) },
    async moveFolders(ids, destParentId, planOnly = false) {
      const plan = planOnly && typeof planOnly === 'object' ? !!planOnly.planOnly : !!planOnly
      return moveFolders(ids, destParentId, plan)
    },

    // The board's two channels on the page's bus. handlers as the cloud adapter's: onElements, onSticky, onBoard,
    // onAudience (once), onLive(event, payload), onPresence([{ key, ...meta }]), onStatus({ channel, status }).
    openBoardChannels(names, handlers = {}) {
      const topic = names?.topic
      const liveTopic = names?.live_topic
      if (!topic || !liveTopic) throw pgError('22023', 'A board\'s channels need their names.')
      let left = false
      let heardAudience = false
      const joined = { topic: false, live: false }
      const call = (name, ...args) => {
        if (left) return
        try { handlers?.[name]?.(...args) } catch (err) { console.warn('[fixtures] a board handler failed:', err?.message || err) }
      }
      const audience = (payload) => {
        if (heardAudience) return
        heardAudience = true
        call('onAudience', payload ?? null)
      }
      const dbSub = {
        userId, meta: null,
        deliver(event, payload) {
          if (event === 'elements') call('onElements', payload)
          else if (event === 'sticky') call('onSticky', payload)
          else if (event === 'board') call('onBoard', payload)
          else if (event === 'AUDIENCE') audience(payload)
        },
      }
      const liveSub = {
        userId, meta: null,
        deliver(event, payload) {
          if (event === PRESENCE) call('onPresence', payload)
          else if (String(event).toUpperCase() === 'AUDIENCE') audience(payload)
          else call('onLive', event, payload)
        },
      }
      queueMicrotask(() => {
        if (left) return
        for (const [which, name, sub] of [['topic', topic, dbSub], ['live', liveTopic, liveSub]]) {
          if (!topicReadable(name)) { call('onStatus', { channel: which, status: 'CHANNEL_ERROR' }); continue }
          busSubs(name).add(sub)
          joined[which] = true
          call('onStatus', { channel: which, status: 'SUBSCRIBED' })
        }
        if (joined.live && liveSub.meta) presenceSync(liveTopic)
      })
      return {
        ready: Promise.resolve(),
        sendLive(event, payload) {
          if (left || !joined.live || !event) return false
          busSay(liveTopic, event, payload ?? {}, liveSub)
          return true
        },
        async track(meta) {
          liveSub.meta = meta ? clone(meta) : null
          if (!left && joined.live) presenceSync(liveTopic)
        },
        leave() {
          if (left) return
          left = true
          BUS.get(topic)?.delete(dbSub)
          if (BUS.get(liveTopic)?.delete(liveSub)) presenceSync(liveTopic)
        },
      }
    },
  }
}
