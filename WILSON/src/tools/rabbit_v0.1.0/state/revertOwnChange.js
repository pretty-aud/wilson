// =============================================================================
// revertOwnChange — what a FAILED optimistic write takes back (post-overhaul
// S5d, review round 2, R2-02).
//
// `optimistic` (RabbitProvider) applies a write's mutator at once and, when
// the backend refuses it, put back the whole bundle as it stood when the
// write began. Every write and version step that landed meanwhile went with
// it — a second drag that succeeded, the rows an open set aside — from the
// screen and, since S5d's R1-01, from `bundleRef`; without live sync nothing
// brought them back, and the next Save wrote the stale schedule into the open
// version (MEASURED by S5d's review round 2).
//
// What the write changed is read off its own mutator, run on the snapshot
// (mutators are pure): in each collection, the rows it added go again, the
// rows it removed come back where they were, and in a row it changed only
// the fields it changed are put back — each only while it still holds the
// write's value, so a later write to the same field keeps its own. A key
// that is a record (the project) is put back field by field the same way;
// anything else only if nothing has replaced it since.
// =============================================================================

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** A collection this can take back row by row: every row a record with an id. */
const keyed = (rows) => Array.isArray(rows) && rows.every(r => isRecord(r) && r.id != null)

/** `now` with each field `after` changed from `before` put back, while it still holds `after`'s value. */
export function revertFields(now, before, after) {
  if (!isRecord(now) || before === after) return now
  let out = now
  for (const f of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (Object.is(before[f], after[f])) continue
    if (!Object.is(now[f], after[f])) continue // changed again since: the later write's
    if (out === now) out = { ...now }
    if (Object.prototype.hasOwnProperty.call(before, f)) out[f] = before[f]
    else delete out[f]
  }
  return out
}

/** The rows `now` with what took `before` to `after` taken back (rows matched by id). */
export function revertRows(now, before, after) {
  const beforeById = new Map(before.map(r => [r.id, r]))
  const afterById = new Map(after.map(r => [r.id, r]))
  let out = now
  const edit = () => { if (out === now) out = now.slice(); return out }
  // Added by the write: gone again.
  for (const id of afterById.keys()) {
    if (beforeById.has(id)) continue
    const i = out.findIndex(r => r?.id === id)
    if (i >= 0) edit().splice(i, 1)
  }
  // Changed by the write: the fields it changed put back.
  for (const [id, a] of afterById) {
    const b = beforeById.get(id)
    if (!b || a === b) continue
    const i = out.findIndex(r => r?.id === id)
    if (i < 0) continue
    const r = revertFields(out[i], b, a)
    if (r !== out[i]) edit()[i] = r
  }
  // Removed by the write: back where it was, unless it is back already.
  before.forEach((b, at) => {
    if (afterById.has(b.id) || out.some(r => r?.id === b.id)) return
    edit().splice(Math.min(at, out.length), 0, b)
  })
  return out
}

/**
 * The bundle `current` with the change of a write that failed taken back.
 * `snapshot` is the bundle the write began from; `applied`, its mutator run
 * on that snapshot. Returns `current` itself when there is nothing to take
 * back.
 */
export function revertOwnChange(current, snapshot, applied) {
  if (!isRecord(current) || !isRecord(snapshot) || !isRecord(applied) || applied === snapshot) return current
  let out = current
  for (const key of new Set([...Object.keys(snapshot), ...Object.keys(applied)])) {
    const before = snapshot[key]
    const after = applied[key]
    if (before === after) continue
    const now = current[key]
    let next
    if (keyed(before) && keyed(after) && Array.isArray(now)) next = revertRows(now, before, after)
    else if (isRecord(before) && isRecord(after) && isRecord(now)) next = revertFields(now, before, after)
    else next = now === after ? before : now
    if (next !== now) {
      if (out === current) out = { ...current }
      out[key] = next
    }
  }
  return out
}
