// ============================================================
// RABBIT — bins: pure selectors (tree, filter, sort, stats)
// ============================================================
//
// Everything the Bins view computes from rows lives here, without React, so
// binSelectors.test.js can pin the behaviour: the tree order, what a search
// matches, what a filter chip excludes, how "manual" order sorts, and what
// the bin header's counts and durations are made of.

export function buildBinTree(bins) {
  const byParent = new Map()
  for (const b of bins || []) {
    const key = b.parent_bin_id || null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(b)
  }
  const ids = new Set((bins || []).map(b => b.id))
  const order = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.name || '').localeCompare(String(b.name || ''))
  const seen = new Set()
  const build = (parentKey) => (byParent.get(parentKey) || []).slice().sort(order).map(bin => {
    seen.add(bin.id)
    return { bin, children: build(bin.id) }
  })
  const roots = build(null)
  // An orphan (parent id pointing at a bin that no longer exists) is shown at
  // the root rather than lost — never a bin that cannot be reached.
  for (const b of (bins || []).slice().sort(order)) {
    if (!seen.has(b.id) && b.parent_bin_id && !ids.has(b.parent_bin_id)) {
      roots.push({ bin: b, children: build(b.id) })
      seen.add(b.id)
    }
  }
  return roots
}

export function flattenTree(tree, expanded = null, depth = 0, out = []) {
  for (const node of tree || []) {
    const hasChildren = node.children.length > 0
    out.push({ bin: node.bin, depth, hasChildren })
    if (hasChildren && (!expanded || expanded.has(node.bin.id))) flattenTree(node.children, expanded, depth + 1, out)
  }
  return out
}

export function descendantIds(bins, id) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const b of bins || []) {
      if (b.parent_bin_id && out.has(b.parent_bin_id) && !out.has(b.id)) { out.add(b.id); grew = true }
    }
  }
  return out
}

export function binPathLabel(bins, id) {
  const byId = new Map((bins || []).map(b => [b.id, b]))
  const parts = []
  let cur = byId.get(id)
  const guard = new Set()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    parts.unshift(cur.name || 'Untitled')
    cur = cur.parent_bin_id ? byId.get(cur.parent_bin_id) : null
  }
  return parts.join(' / ')
}

/** Files per bin INCLUDING descendants, as a Map binId → count. */
export function countsByBin(bins, files) {
  // One post-order pass (adversarial review: the first draft called
  // descendantIds per bin, cubic in the number of bins).
  const direct = new Map()
  for (const f of files || []) direct.set(f.bin_id, (direct.get(f.bin_id) || 0) + 1)
  const children = new Map()
  for (const b of bins || []) {
    const key = b.parent_bin_id || null
    if (!children.has(key)) children.set(key, [])
    children.get(key).push(b.id)
  }
  const out = new Map()
  const visiting = new Set()
  const total = (id) => {
    if (out.has(id)) return out.get(id)
    if (visiting.has(id)) return 0 // a cycle on disk: count nothing twice
    visiting.add(id)
    let n = direct.get(id) || 0
    for (const c of children.get(id) || []) n += total(c)
    visiting.delete(id)
    out.set(id, n)
    return n
  }
  for (const b of bins || []) total(b.id)
  return out
}

export const SORT_FIELDS = [
  { id: 'sort_order',   label: 'Added order' },
  { id: 'display_name', label: 'Name' },
  { id: 'original_name', label: 'File name' },
  { id: 'media_type',   label: 'Type' },
  { id: 'slate',        label: 'Slate' },
  { id: 'take_number',  label: 'Take' },
  { id: 'camera',       label: 'Camera' },
  { id: 'roll',         label: 'Roll' },
  { id: 'shoot_day',    label: 'Shoot day' },
  { id: 'duration_sec', label: 'Duration' },
  { id: 'size_bytes',   label: 'Size' },
  { id: 'review_flag',  label: 'Flag' },
  { id: 'color',        label: 'Colour' },
  { id: 'added_at',     label: 'Added' },
]

const NUMERIC = new Set(['sort_order', 'take_number', 'duration_sec', 'size_bytes', 'width', 'height', 'fps', 'frame_count'])
const FLAG_RANK = { select: 0, unflagged: 1, reject: 2 }

// The slate sorts naturally: 12 before 12A before 100. A plain string sort
// would put 100 before 12, which no editor expects.
export function slateKey(s) {
  const m = /^(\d+)([A-Za-z]*)$/.exec(String(s || '').trim())
  if (!m) return [Number.POSITIVE_INFINITY, String(s || '').toLowerCase()]
  return [Number(m[1]), m[2].toLowerCase()]
}

export function sortBinFiles(files, { field = 'sort_order', dir = 'asc' } = {}) {
  const sign = dir === 'desc' ? -1 : 1
  const rows = (files || []).slice()
  const cmp = (a, b) => {
    let r = 0
    if (field === 'slate') {
      const [an, as] = slateKey(a.slate); const [bn, bs] = slateKey(b.slate)
      r = an - bn || as.localeCompare(bs)
    } else if (field === 'review_flag') {
      r = (FLAG_RANK[a.review_flag] ?? 1) - (FLAG_RANK[b.review_flag] ?? 1)
    } else if (NUMERIC.has(field)) {
      // Compared, never subtracted: two nulls are both -Infinity and
      // (-Inf) - (-Inf) is NaN, which skipped the tie-break below and left
      // un-probed rows in arbitrary order (adversarial review).
      const av = a[field] == null ? Number.NEGATIVE_INFINITY : Number(a[field])
      const bv = b[field] == null ? Number.NEGATIVE_INFINITY : Number(b[field])
      r = av < bv ? -1 : av > bv ? 1 : 0
    } else {
      const av = String(a[field] ?? '').toLowerCase(); const bv = String(b[field] ?? '').toLowerCase()
      if (!av && bv) r = 1; else if (av && !bv) r = -1; else r = av.localeCompare(bv)
    }
    if (r === 0) r = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    if (r === 0) r = String(a.display_name || '').localeCompare(String(b.display_name || ''))
    return r * sign
  }
  return rows.sort(cmp)
}

export const EMPTY_FILTERS = Object.freeze({
  mediaTypes: [], flags: [], circled: null, colors: [], sceneIds: [], shotIds: [], cameras: [], days: [], tags: [], online: null,
})

export function isFilterEmpty(filters) {
  const f = filters || EMPTY_FILTERS
  return !f.mediaTypes?.length && !f.flags?.length && f.circled == null && !f.colors?.length && !f.sceneIds?.length
    && !f.shotIds?.length && !f.cameras?.length && !f.days?.length && !f.tags?.length && f.online == null
}

export function activeFilterCount(filters) {
  const f = filters || EMPTY_FILTERS
  return (f.mediaTypes?.length ? 1 : 0) + (f.flags?.length ? 1 : 0) + (f.circled != null ? 1 : 0) + (f.colors?.length ? 1 : 0)
    + (f.sceneIds?.length ? 1 : 0) + (f.shotIds?.length ? 1 : 0) + (f.cameras?.length ? 1 : 0) + (f.days?.length ? 1 : 0)
    + (f.tags?.length ? 1 : 0) + (f.online != null ? 1 : 0)
}

/** Search matches name, file name, slate, notes, description, tags, path, camera, roll. */
export function matchesSearch(row, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return true
  const hay = [row.display_name, row.original_name, row.slate, row.notes, row.description, row.camera, row.roll, row.codec, row.source_path, ...(row.tags || [])]
    .filter(Boolean).join(' | ').toLowerCase()
  return s.split(/\s+/).every(term => hay.includes(term))
}

export function filterBinFiles(files, filters, search) {
  const f = filters || EMPTY_FILTERS
  const mt = f.mediaTypes?.length ? new Set(f.mediaTypes) : null
  const fl = f.flags?.length ? new Set(f.flags) : null
  const co = f.colors?.length ? new Set(f.colors) : null
  const sc = f.sceneIds?.length ? new Set(f.sceneIds) : null
  const sh = f.shotIds?.length ? new Set(f.shotIds) : null
  const ca = f.cameras?.length ? new Set(f.cameras.map(c => String(c).toUpperCase())) : null
  const da = f.days?.length ? new Set(f.days) : null
  const tg = f.tags?.length ? new Set(f.tags.map(t => t.toLowerCase())) : null
  return (files || []).filter(r => {
    if (mt && !mt.has(r.media_type)) return false
    if (fl && !fl.has(r.review_flag || 'unflagged')) return false
    if (f.circled != null && !!r.circled !== !!f.circled) return false
    if (co && !co.has(r.color || 'none')) return false
    if (sc && !sc.has(r.scene_id || 'none')) return false
    if (sh && !sh.has(r.shot_id || 'none')) return false
    if (ca && !ca.has(String(r.camera || '').toUpperCase() || 'none')) return false
    if (da && !da.has(r.shoot_day || 'none')) return false
    if (tg && !(r.tags || []).some(t => tg.has(String(t).toLowerCase()))) return false
    if (f.online != null && (r.online !== false) !== !!f.online) return false
    return matchesSearch(r, search)
  })
}

export function binStats(files) {
  let durationSec = 0; let sizeBytes = 0; let offline = 0; let selects = 0; let rejects = 0; let circled = 0
  for (const r of files || []) {
    durationSec += Number(r.duration_sec) || 0
    sizeBytes += Number(r.size_bytes) || 0
    if (r.online === false) offline++
    if (r.review_flag === 'select') selects++
    if (r.review_flag === 'reject') rejects++
    if (r.circled) circled++
  }
  return { count: (files || []).length, durationSec, sizeBytes, offline, selects, rejects, circled }
}

export function distinctValues(files, key) {
  const set = new Set()
  for (const r of files || []) {
    if (key === 'tags') { for (const t of r.tags || []) set.add(String(t)) }
    else if (r[key] != null && r[key] !== '') set.add(String(r[key]))
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** For bulk editing: the shared value of `key` across rows, or mixed. */
export function mixedValue(rows, key) {
  if (!rows?.length) return { value: null, mixed: false }
  const first = rows[0][key]
  const same = rows.every(r => {
    const v = r[key]
    if (Array.isArray(v) || Array.isArray(first)) return JSON.stringify(v || []) === JSON.stringify(first || [])
    return (v ?? null) === (first ?? null)
  })
  return same ? { value: first ?? null, mixed: false } : { value: null, mixed: true }
}

/** Keyboard: the id `steps` rows away from `currentId` in `orderedIds`, clamped. */
export function stepId(orderedIds, currentId, steps) {
  if (!orderedIds?.length) return null
  const i = orderedIds.indexOf(currentId)
  if (i < 0) return steps >= 0 ? orderedIds[0] : orderedIds[orderedIds.length - 1]
  const j = Math.max(0, Math.min(orderedIds.length - 1, i + steps))
  return orderedIds[j]
}

/** Rows between two ids inclusive, in list order — shift-click and shift-arrow. */
export function rangeIds(orderedIds, fromId, toId) {
  const a = orderedIds.indexOf(fromId); const b = orderedIds.indexOf(toId)
  if (a < 0 || b < 0) return toId ? [toId] : []
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return orderedIds.slice(lo, hi + 1)
}
