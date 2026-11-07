// mothViewState.js — MO2: what a view is, as plain data (the brief §2 and §3.1; MOTH_DESIGN §2.5's S2 spec).
//
// A view chooses which kinds of thing are dots, which kinds of line join them, the layout, how far focus reaches
// and which tags to keep. That is its config, and it is all a saved view stores in moth_views: never an id (the
// server refuses one), so what is open, pinned or in focus lives in the view's places (moth_layout_positions).
// The two quick starts are views too, never stored: Everything by folders, and Everything by tags.
import { NODE_KINDS, EDGE_KINDS, ITEM_KINDS, FOCUS_MAX_DEPTH, nodeId, indexCatalogue } from '../engine/model.js'

/** The file tags' fixed words a person can filter by (0085), less the two that never reach Moth. */
export const TAG_WORDS = Object.freeze(['production', 'creative', 'reference', 'assets', 'code', 'shots', 'documentation'])
export const LAYOUTS = Object.freeze(['force', 'radial'])

export const QUICK_VIEWS = Object.freeze({
  'q:folders': Object.freeze({
    name: 'Everything by folders',
    config: Object.freeze({ nodeKinds: ['project', 'folder', 'file'], edgeKinds: ['lives_in'], layout: 'force', focusDepth: 1, tags: [] }),
  }),
  'q:tags': Object.freeze({
    name: 'Everything by tags',
    config: Object.freeze({ nodeKinds: ['file', 'tag'], edgeKinds: ['tagged_with'], layout: 'force', focusDepth: 1, tags: [], openAll: true }),
  }),
})
export const isQuick = (key) => Object.prototype.hasOwnProperty.call(QUICK_VIEWS, key)
/** What the view widget calls a view changed from a quick start and not saved yet. */
export const UNSAVED_LABEL = 'Unsaved view'

/** A config as Moth reads it: only known keys, each of its own shape; anything else is dropped. */
export function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const pick = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter((k) => allowed.includes(k)))] : null)
  const nodeKinds = pick(c.nodeKinds, NODE_KINDS)
  const edgeKinds = pick(c.edgeKinds, EDGE_KINDS)
  return {
    nodeKinds: nodeKinds && nodeKinds.length ? nodeKinds : ['project', 'folder', 'file'],
    edgeKinds: edgeKinds ?? ['lives_in'],
    layout: LAYOUTS.includes(c.layout) ? c.layout : 'force',
    focusDepth: c.focusDepth === 2 ? 2 : 1,
    tags: pick(c.tags, TAG_WORDS) ?? [],
    openAll: c.openAll === true,
  }
}

/** True when a config holds anything shaped like an id (the server's moth_views_config_no_ids_chk). */
export const configHasId = (config) => /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i.test(JSON.stringify(config ?? {}))

/** The view the engine draws: open containers and the focus come from the view's places, not its config. */
export function engineView(config, { open = [], focusId = null } = {}) {
  const c = normalizeConfig(config)
  return {
    nodeKinds: c.nodeKinds,
    edgeKinds: c.edgeKinds,
    expanded: c.openAll ? 'all' : new Set(open),
    focus: focusId ? { id: focusId, depth: Math.min(FOCUS_MAX_DEPTH, c.focusDepth) } : null,
  }
}

/** The catalogue with only the files carrying one of `tags` (a tag filter); none chosen keeps every file. */
export function filterByTags(catalogue, tags) {
  if (!tags || !tags.length) return catalogue
  const want = new Set(tags)
  const files = {}
  for (const [pid, rows] of Object.entries(catalogue.files || {})) {
    files[pid] = rows.filter((f) => Array.isArray(f.tags) && f.tags.some((t) => want.has(String(t).trim().toLowerCase())))
  }
  return { ...catalogue, files }
}

/** What opens the way to a dot: its containers, outermost first (to expand them so it is drawn). */
export function containersOf(catalogue, id, index = indexCatalogue(catalogue)) {
  const out = []
  for (let a = index.parent.get(id), steps = 0; a != null && steps < 80; a = index.parent.get(a), steps++) out.unshift(a)
  return out
}

/**
 * The names a search finds, across everything read, best first: a whole-word start beats a match inside a word.
 * At most `limit`. Each is { id, kind, label, projectId }.
 */
export function searchCatalogue(catalogue, words, { limit = 20, index = indexCatalogue(catalogue) } = {}) {
  const q = String(words ?? '').trim().toLowerCase()
  if (!q) return []
  const hits = []
  for (const [id, row] of index.rows) {
    const label = String(row.label ?? '').toLowerCase()
    const at = label.indexOf(q)
    if (at < 0) continue
    const wordStart = at === 0 || /[\s._\-/]/.test(label[at - 1])
    hits.push({ id, kind: row.kind, label: row.label, projectId: row.projectId, score: (wordStart ? 0 : 1) * 1000 + label.length })
  }
  hits.sort((a, b) => a.score - b.score || String(a.label).localeCompare(String(b.label)))
  return hits.slice(0, limit).map(({ score: _s, ...h }) => h)
}

/** The kinds the view widget offers as dots, in its order, with their words. */
export const DOT_CHOICES = Object.freeze([
  ['project', 'Projects'], ['folder', 'Folders'], ['file', 'Files'], ['tag', 'Tags'],
  ...ITEM_KINDS.map((k) => [k, { phase: 'Phases', asset: 'Assets', task: 'Tasks', scene: 'Scenes', shot: 'Shots', level: 'Levels', experience: 'Experiences' }[k]]),
])
export const LINE_CHOICES = Object.freeze([['lives_in', 'Lives in'], ['tagged_with', 'Tagged with'], ['related_to', 'Related to']])

/** A project's island as a dot id, for the quick start that opens every project. */
export const projectDot = (id) => nodeId('project', id)
