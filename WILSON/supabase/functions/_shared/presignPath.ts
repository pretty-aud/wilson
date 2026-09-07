// =============================================================================
// _shared/presignPath.ts — Session 37
//
// The storage-presign function's path gate, pure and runtime-agnostic (no
// Deno.* — importable by the repo's vitest across the boundary, the
// s3Presign.ts arrangement).
//
// A presignable path must be ROW-SHAPED: exactly what
// supabaseAdapter.uploadFile writes into files.storage_path —
// projects/<uuid>/<entity>/<entityId>/<ts>-<name> — in the sanitiser's own
// charset. The workspace prefix is NEVER part of it: 0051 stores row-shaped
// keys (the split_part money axis must keep its third segment; a prefix
// edit must not orphan keys), and the presign function prepends the prefix
// server-side.
//
// Money-segment refusal lives HERE, at the shape gate, so no later branch
// can forget it: money never leaves Supabase (§4a2b invariant 2), so a
// money-shaped path is refused before any authorisation is even asked.
// =============================================================================

import { isMoneySegment } from './moneySegments.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The uploadFile sanitiser's own charset — every row-shaped segment fits it,
// and nothing outside it was ever written by the product.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/

export type PathCheck = { ok: true; projectId: string } | { ok: false; detail: string }

/** Row-shaped and canonical, or a sentence. Returns the project id. */
export function checkRowShapedPath(path: unknown): PathCheck {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, detail: 'no object path was given' }
  }
  if (path.length > 1024) {
    return { ok: false, detail: 'the object path is too long' }
  }
  const segs = path.split('/')
  if (segs[0] !== 'projects' || segs.length < 3) {
    return { ok: false, detail: 'the path must be row-shaped: projects/<project-id>/…' }
  }
  if (!UUID_RE.test(segs[1] ?? '')) {
    return { ok: false, detail: 'the second path segment must be the project id' }
  }
  for (const s of segs) {
    if (s === '') return { ok: false, detail: 'the path carries an empty segment (leading, trailing or doubled slash)' }
    if (s === '.' || s === '..') return { ok: false, detail: 'the path carries a dot segment' }
    if (!SEGMENT_RE.test(s)) return { ok: false, detail: 'the path carries characters the uploader never writes' }
  }
  if (isMoneySegment(segs[2])) {
    return { ok: false, detail: 'money-gated files never leave Supabase — this path cannot be presigned' }
  }
  return { ok: true, projectId: segs[1] }
}
