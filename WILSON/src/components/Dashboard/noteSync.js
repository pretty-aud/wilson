// ============================================================
// WILSON Dashboard — noteSync (Session 8)
// ============================================================
//
// The Yjs persistence helpers for Notes. The multi-device story (locked
// decision #6 — Yjs ONLY for long-form text) is snapshot-merge-write:
//
//   save:    UPDATE notes SET ydoc_state, version = v+1 WHERE version = v
//   miss:    another device saved first → fetch the remote snapshot,
//            Y.applyUpdate it into the local doc (Yjs updates are
//            commutative + idempotent, so double-apply is harmless),
//            retry with the fresh version.
//
// Every retry is strictly MORE converged than the last, so the bounded
// loop terminates with no data loss and no Yjs server. saveNoteDoc (the
// adapter) is the only writer of ydoc_state/version.
//
// Encoding: base64 in a text column. The chunked codec matters — a naive
// String.fromCharCode(...spread) overflows the call stack on multi-hundred-
// KB snapshots, and Uint8Array.toBase64 isn't in Electron 33's Chromium.

/** Uint8Array → base64 (chunked; safe for large snapshots). */
export function u8ToB64(u8) {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

/** base64 → Uint8Array. */
export function b64ToU8(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

/**
 * Version-guarded save with merge-on-conflict retry.
 *
 * Dependencies are injected so the loop is unit-testable without yjs or a
 * network:
 *   encode()            → current local snapshot (base64 string)
 *   save(b64, version)  → Promise<{version}|null> — null = guard missed
 *   fetchRemote()       → Promise<{ydocState, version}|null> — fresh row
 *   applyRemote(b64)    → merge a remote snapshot into the local doc
 *
 * Returns { version, conflicts } on success. Throws after maxAttempts —
 * with merge-on-retry that means something is genuinely wrong (e.g. the
 * row vanished), not merely a fast typer on the other device.
 */
export async function saveWithMerge({
  encode,
  save,
  fetchRemote,
  applyRemote,
  expectedVersion,
  maxAttempts = 5,
}) {
  let version = expectedVersion
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await save(encode(), version)
    if (res) return { version: res.version, conflicts: attempt }
    const remote = await fetchRemote()
    if (!remote) throw new Error('note save: row no longer exists')
    if (remote.ydocState) applyRemote(remote.ydocState)
    version = remote.version ?? version
  }
  throw new Error('note save: too many version conflicts')
}

/** Plain-text preview for the notes list (bounded by the DB check). */
export function toPreview(text, max = 300) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
