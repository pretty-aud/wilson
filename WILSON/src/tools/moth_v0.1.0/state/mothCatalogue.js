// mothCatalogue.js — MO2: everything Moth shows, read once through Moth's own methods, for the graph and the list.
//
// One store per adapter. It reads the person's islands (moth_islands), then each island's folders, files (every
// page, keyed on the last id), items and links (0122), and hands the graph engine its catalogue. Every file row
// passes mothFileHidden as a second look, as Session 1's list did, so the graph, the list, the search and a
// selection can only hold what the server already let through.
//
// The light follows the size of everything the person can see (the brief §1.1), so glowSize counts only
// projects read whole: an island still loading or one that failed adds nothing, and the light grows once, as the
// first read completes, never as the person moves between folders.
//
// Each project's read has its number, and only the newest may land: a read that comes back after a newer one
// (a refresh after a move) is dropped. A failed read is kept apart from an empty one.
import { mothFileHidden } from './mothEligibility.js'
import { catalogueSize } from '../engine/model.js'

export const FILE_PAGE = 1000
/** At most this many pages of files a project (50,000 files): past it the project says it is not shown whole. */
export const MAX_FILE_PAGES = 50
const CONCURRENCY = 3

const absent = (err) => err?.code === 'moth_absent'
const FACT_KINDS = ['phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience']

export function createMothCatalogue({ adapter }) {
  const listeners = new Set()
  let islands = null // null until read
  let islandsFailed = false
  const projects = new Map() // id -> { status: 'loading' | 'ready' | 'failed', folders, files, items, links, truncated, error }
  const readNumber = new Map() // id -> the newest read's number
  let itemsAbsent = false
  let version = 0
  let snapshot = null
  let cachedCatalogue = null
  let cachedVersion = -1
  let destroyed = false

  const emit = () => {
    version++
    snapshot = null
    for (const fn of [...listeners]) fn()
  }

  async function readFiles(pid, known) {
    const out = []
    let after = null
    for (let page = 0; page < MAX_FILE_PAGES; page++) {
      const rows = (await adapter.listMothFiles(pid, after, FILE_PAGE)) || []
      for (const row of rows) if (!mothFileHidden(row, known)) out.push(row)
      if (rows.length < FILE_PAGE) return { files: out, truncated: false }
      after = rows[rows.length - 1]?.id ?? null
      if (after == null) return { files: out, truncated: false }
    }
    return { files: out, truncated: true }
  }

  // A read 0122 brought: on a database without it the graph shows files and folders, and says nothing is wrong.
  async function readOptional(fn, fallback) {
    if (typeof fn !== 'function') return fallback
    try {
      return (await fn()) || fallback
    } catch (err) {
      if (absent(err)) { itemsAbsent = true; return fallback }
      throw err
    }
  }

  // What each file is filed against, and who last changed it, a page at a time as the files are.
  async function readFacts(pid) {
    if (typeof adapter.listMothFileFacts !== 'function') return { facts: [], truncated: false }
    const out = []
    let after = null
    for (let page = 0; page < MAX_FILE_PAGES; page++) {
      const rows = await readOptional(() => adapter.listMothFileFacts(pid, after, FILE_PAGE), [])
      out.push(...rows)
      if (rows.length < FILE_PAGE) return { facts: out, truncated: false }
      after = rows[rows.length - 1]?.file_id ?? null
      if (after == null) return { facts: out, truncated: false }
    }
    return { facts: out, truncated: true }
  }

  async function readProject(pid) {
    const asked = (readNumber.get(pid) || 0) + 1
    readNumber.set(pid, asked)
    const was = projects.get(pid)
    projects.set(pid, { ...(was || {}), status: was?.status === 'ready' ? 'ready' : 'loading', refreshing: true })
    emit()
    try {
      // The signed-out desktop has no server to have removed money and Legal, so the second look is the only one,
      // and it is told what a row cannot say. A failure to read that shows nothing, not everything.
      const known = adapter.mothHiddenFacts ? await adapter.mothHiddenFacts(pid) : {}
      const [folders, filesRead, itemsRead, linksRead, factsRead] = await Promise.all([
        adapter.listMothFolders(pid),
        readFiles(pid, known),
        readOptional(() => adapter.listMothItems?.(pid), { items: [], truncated: false }),
        readOptional(() => adapter.listMothLinks?.(pid), { links: [], truncated: false }),
        readFacts(pid),
      ])
      if (destroyed || readNumber.get(pid) !== asked) return
      // A file's own lines, and its last editor, only for a file the second look kept.
      const kept = new Set(filesRead.files.map((f) => f.id))
      const links = [...(linksRead.links || [])]
      const editors = new Map()
      for (const f of factsRead.facts) {
        if (!kept.has(f.file_id)) continue
        if (f.editor_id) editors.set(f.file_id, f.editor_id)
        for (const kind of FACT_KINDS) {
          const id = f[`${kind}_id`]
          if (id) links.push({ source_kind: 'file', source_id: f.file_id, target_kind: kind, target_id: id, link: `file_${kind}` })
        }
      }
      projects.set(pid, {
        status: 'ready', refreshing: false, folders: folders || [], files: filesRead.files, items: itemsRead.items || [], links, editors,
        truncated: filesRead.truncated || itemsRead.truncated === true || linksRead.truncated === true || factsRead.truncated, error: null,
      })
    } catch (err) {
      if (destroyed || readNumber.get(pid) !== asked) return
      projects.set(pid, { status: 'failed', refreshing: false, folders: [], files: [], items: [], links: [], editors: new Map(), truncated: false, error: err?.message || String(err) })
    }
    emit()
  }

  async function readMany(ids) {
    const queue = [...ids]
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length && !destroyed) await readProject(queue.shift())
    })
    await Promise.all(workers)
  }

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    getSnapshot() {
      if (!snapshot) {
        const list = islands || []
        let ready = 0
        let failed = 0
        for (const isle of list) {
          const s = projects.get(isle.id)?.status
          if (s === 'ready') ready++
          else if (s === 'failed') failed++
        }
        snapshot = {
          version, islands, islandsFailed, itemsAbsent,
          ready, failed, total: list.length,
          complete: islands != null && ready + failed === list.length,
          project: (id) => projects.get(id) || null,
        }
      }
      return snapshot
    },
    /** Everything, from the islands down. Re-reading the islands keeps what is already read of each. */
    async loadAll() {
      islandsFailed = false
      emit()
      let rows
      try {
        rows = (await adapter.listMothIslands()) || []
      } catch {
        if (destroyed) return
        islands = islands ?? []
        islandsFailed = true
        emit()
        return
      }
      if (destroyed) return
      islands = rows
      const keep = new Set(rows.map((r) => r.id))
      for (const id of [...projects.keys()]) if (!keep.has(id)) projects.delete(id)
      emit()
      await readMany(rows.map((r) => r.id))
    },
    /** Read these projects again (after a move, a delete, an add, a restore). */
    async refresh(ids) {
      const known = new Set((islands || []).map((r) => r.id))
      await readMany([...new Set(ids)].filter((id) => known.has(id)))
    },
    retryProject(id) { return readProject(id) },
    /** The engine's catalogue (model.js), from every project read so far. Memoized per change. */
    catalogue() {
      if (cachedVersion === version && cachedCatalogue) return cachedCatalogue
      const out = { islands: [], folders: {}, files: {}, items: {}, relations: [] }
      for (const isle of islands || []) {
        out.islands.push(isle)
        const p = projects.get(isle.id)
        if (!p || p.status !== 'ready') continue
        out.folders[isle.id] = p.folders
        out.files[isle.id] = p.files
        out.items[isle.id] = p.items
        for (const l of p.links) {
          out.relations.push({ source: { kind: l.source_kind, id: l.source_id }, target: { kind: l.target_kind, id: l.target_id }, label: l.link ?? null })
        }
      }
      cachedCatalogue = out
      cachedVersion = version
      return out
    },
    /** Who last changed a file, by its id (Settings' colour by), from the project's facts. */
    editorOf(projectId, fileId) {
      return projects.get(projectId)?.editors?.get(fileId) ?? null
    },
    /** The size the light follows: only projects read whole, so it does not grow as islands load or as she moves. */
    glowSize() {
      const whole = { islands: [], folders: {}, files: {}, items: {} }
      for (const isle of islands || []) {
        const p = projects.get(isle.id)
        // A project read only in part counts as what was read: the largest projects light the most.
        if (!p || p.status !== 'ready') continue
        whole.islands.push(isle)
        whole.folders[isle.id] = p.folders
        whole.files[isle.id] = p.files
        whole.items[isle.id] = p.items
      }
      return catalogueSize(whole)
    },
    destroy() { destroyed = true; listeners.clear() },
  }
}
