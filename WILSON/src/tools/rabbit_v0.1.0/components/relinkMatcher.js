// ─────────────────────────────────────────────────────────────────────────────
// relinkMatcher — Session 14, Block A (storage relink).
//
// The pure matching core of the ShotGrid/Blender-style "find missing files"
// feature: given the file ROWS whose blobs no longer resolve and the entries
// found by walking a user-picked folder, propose old-path → new-path remaps.
//
// PROVIDER-AGNOSTIC by design (the S14 brief): nothing in here touches a
// filesystem, Supabase, or Drive. Callers supply plain candidate entries
// ({ relPath, name, size }) from wherever they walked — the local Express
// walker today, a Drive listing later — and apply the proposals themselves.
//
// Matching ladder (deterministic; each rung only sees rows and candidates the
// rungs above left unclaimed, and a candidate is claimed by at most one row):
//   1. 'exact'  — candidate basename equals the old storage_path basename.
//                 local_server disk names are `${uuid}-${safeName}`, so a
//                 moved-but-unrenamed file matches here with zero doubt.
//   2. 'strong' — sanitized display name matches AND size_bytes matches.
//   3. 'name'   — sanitized display name matches exactly one candidate
//                 (after a size tiebreak when several share the name).
// Rows with several surviving same-name candidates land in `ambiguous` with
// the candidate list (the preview surfaces them for a human call — Tesler's
// law: the system absorbs what it can, and is honest about what it can't).
// Everything else lands in `unmatched`.
//
// Comparisons are case-insensitive: the primary target is Windows/macOS
// filesystems, where `Shot_01.PNG` and `shot_01.png` are the same file.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirror of the upload-side filename sanitizer (main.cjs / supabaseAdapter). */
export function sanitizeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

/** Last path segment of a storage path or relPath (either separator). */
export function pathBasename(p) {
  const s = String(p || '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

const fold = (s) => String(s || '').toLowerCase()

/**
 * Match dangling file rows against walked candidates.
 *
 * @param {Array<{id: string, name: string, storage_path: string,
 *                size_bytes?: number|null, mime_type?: string|null}>} missing
 * @param {Array<{relPath: string, name: string, size?: number|null}>} candidates
 * @returns {{
 *   proposals: Array<{id, name, oldPath, newPath, confidence}>,
 *   ambiguous: Array<{id, name, oldPath, candidates: Array<{relPath, name, size}>}>,
 *   unmatched: Array<{id, name, oldPath}>,
 * }}
 */
export function matchMissingFiles(missing, candidates) {
  const proposals = []
  const ambiguous = []
  const unmatched = []

  const pool = (candidates || []).map((c, idx) => ({ ...c, _idx: idx }))
  const claimed = new Set()
  const rows = (missing || []).map((r) => ({ row: r, resolved: false }))

  const claim = (row, cand, confidence) => {
    claimed.add(cand._idx)
    proposals.push({
      id: row.id,
      name: row.name,
      oldPath: row.storage_path,
      newPath: cand.relPath,
      confidence,
    })
  }

  // Rung 1: exact disk-name match.
  for (const entry of rows) {
    const want = fold(pathBasename(entry.row.storage_path))
    if (!want) continue
    const hits = pool.filter((c) => !claimed.has(c._idx) && fold(c.name) === want)
    if (hits.length === 1) {
      claim(entry.row, hits[0], 'exact')
      entry.resolved = true
    } else if (hits.length > 1) {
      // Identical disk names in two walked subfolders — a duplicate copy.
      // Prefer a size match; otherwise this is genuinely ambiguous.
      const bySize = hits.filter((c) => c.size != null && c.size === entry.row.size_bytes)
      if (bySize.length === 1) {
        claim(entry.row, bySize[0], 'exact')
        entry.resolved = true
      } else {
        ambiguous.push({
          id: entry.row.id,
          name: entry.row.name,
          oldPath: entry.row.storage_path,
          candidates: hits.map(({ _idx, ...c }) => c),
        })
        entry.resolved = true // settled as ambiguous; later rungs must not re-claim
      }
    }
  }

  // Rung 2 (FULL pass first): display name + exact size, across ALL
  // unresolved rows before any name-only claim — otherwise a row whose
  // size does NOT match could steal, via the weaker rung below, the very
  // candidate a later same-named row matches by name AND size
  // (adversarial review, S14).
  for (const entry of rows) {
    if (entry.resolved) continue
    const want = fold(sanitizeFileName(entry.row.name))
    const sized = pool.filter((c) => !claimed.has(c._idx)
      && fold(sanitizeFileName(c.name)) === want
      && c.size != null && c.size === entry.row.size_bytes)
    if (sized.length === 1) {
      claim(entry.row, sized[0], 'strong')
      entry.resolved = true
    }
  }

  // Rung 3: name-only on whatever both stronger rungs left unclaimed.
  for (const entry of rows) {
    if (entry.resolved) continue
    const want = fold(sanitizeFileName(entry.row.name))
    const hits = pool.filter((c) => !claimed.has(c._idx) && fold(sanitizeFileName(c.name)) === want)
    if (hits.length === 0) {
      unmatched.push({ id: entry.row.id, name: entry.row.name, oldPath: entry.row.storage_path })
      continue
    }
    if (hits.length === 1) {
      claim(entry.row, hits[0], 'name')
      continue
    }
    ambiguous.push({
      id: entry.row.id,
      name: entry.row.name,
      oldPath: entry.row.storage_path,
      candidates: hits.map(({ _idx, ...c }) => c),
    })
  }

  return { proposals, ambiguous, unmatched }
}
