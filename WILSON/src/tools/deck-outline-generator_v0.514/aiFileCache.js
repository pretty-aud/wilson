// =============================================================================
// aiFileCache — what D.O.G. holds in the AI provider's file store (FX12,
// 2026-10-25, OUTSTANDING DG1-03).
//
// A PDF, a picture, or a text over 256 KB goes to the store once and travels
// as a file id (S19, the 546 fix). The cache keeps that id so a re-generation
// and every call of the continuation loop reuse it instead of uploading a
// multi-megabyte PDF again. Until FX12 the cache only ever grew, and nothing
// deleted what it held. Now each entry knows:
//
//   * its OWNERS: the picker upload (`upload:<id>`) and the chosen references
//     (`ref:<key>`) whose content it is (one content can be both), or
//     `generation` for a source rebuilt every generation (the references'
//     own text), which nothing re-uses;
//   * WHEN it was uploaded: past AI_FILE_TTL_MS it is dropped and uploaded
//     again rather than referenced, so an id the sweep (24 h) or the store's
//     own expiry (24 h, aiFiles.js) has taken never reaches a messages call.
//
// D.O.G. lets go of an entry when no owner is live any more (the file is
// removed from the picker, the reference is untaken, the set is cleared),
// and of everything when the app closes or the person signs out. NEVER after
// a generation: re-use is the point.
// =============================================================================

/** Shorter than the sweep's 24 h and the store's 24 h expiry, with room for a long deck. */
export const AI_FILE_TTL_MS = 20 * 60 * 60 * 1000

/** Who an entry belongs to, from the source entry buildSourceParts sends. */
export function ownerOf(fileData) {
  if (fileData?.refKey) return `ref:${fileData.refKey}`
  if (fileData?.source === 'references') return 'generation'
  return `upload:${fileData?.id}`
}

/** The owners still on screen: the picker's uploads and the chosen references. */
export function liveOwners(uploadedFiles, chosenKeys) {
  const live = new Set()
  for (const f of uploadedFiles || []) live.add(`upload:${f.id}`)
  for (const k of chosenKeys || []) live.add(`ref:${k}`)
  return live
}

export function createAIFileCache({ ttlMs = AI_FILE_TTL_MS } = {}) {
  const entries = new Map() // key -> { id, uploadedAt, owners: Set }

  return {
    /**
     * The id for this content: `{ id }` while fresh; `{ expired }` (the old
     * id, to let go of) once past the TTL, the entry dropped; null if none.
     */
    get(key, nowMs) {
      const e = entries.get(key)
      if (!e) return null
      if (nowMs - e.uploadedAt >= ttlMs) {
        entries.delete(key)
        return { expired: e.id }
      }
      return { id: e.id }
    },
    addOwner(key, owner) {
      entries.get(key)?.owners.add(owner)
    },
    set(key, id, owner, nowMs) {
      const prev = entries.get(key)
      entries.set(key, { id, uploadedAt: nowMs, owners: new Set([owner]) })
      return prev && prev.id !== id ? prev.id : null
    },
    /** Drop every entry with no live owner; answers their ids, to delete. */
    release(live) {
      const gone = []
      for (const [key, e] of entries) {
        for (const o of [...e.owners]) if (!live.has(o)) e.owners.delete(o)
        if (!e.owners.size) {
          entries.delete(key)
          gone.push(e.id)
        }
      }
      return gone
    },
    /** Forget one id (the store said it is gone); answers whether it was held. */
    forgetId(id) {
      for (const [key, e] of entries) {
        if (e.id === id) { entries.delete(key); return true }
      }
      return false
    },
    /** Everything, emptied: the app closing, a sign-out. */
    takeAll() {
      const ids = [...entries.values()].map(e => e.id)
      entries.clear()
      return ids
    },
    get size() { return entries.size },
  }
}

/**
 * The ids a failed AI call says are gone from the store.
 *
 * MEASURED (FX12's CI probe, scripts/probes/ai-files.sh, every push): a
 * messages call that references a deleted file is refused before inference
 * with HTTP 400 or 404, and the store's message names the id. ai-proxy
 * forwards that status and message (AIProxyError .status, .message). An id
 * the message does not name is never assumed dead: a 400 about something
 * else must not cost a re-upload.
 */
export function deadFileIds(err, ids) {
  const status = err?.status
  if (status !== 400 && status !== 404) return []
  const msg = String(err?.message || '')
  return (ids || []).filter(id => id && msg.includes(id))
}

/**
 * One AI call, and once more if the store says a file the call references is
 * gone: that file is uploaded again (`reupload(fileData)` answers the new
 * id), its old id forgotten, every content part that named the old id names
 * the new one, and the call repeated. Once per generation: `live.retried`
 * is shared by every call of a continuation loop. A second refusal, or one
 * that names no file of this call, is thrown as it came.
 *
 * @param {() => Promise<any>} call
 * @param {{ contentParts: object[], fileSources: Map<string, object>, retried: boolean }} live
 * @param {{ reupload: (fileData: object) => Promise<string>, forget: (id: string) => void }} deps
 */
export async function retryWithLiveFiles(call, live, { reupload, forget }) {
  try {
    return await call()
  } catch (err) {
    const sources = live?.fileSources
    if (!sources || live.retried) throw err
    const dead = deadFileIds(err, [...sources.keys()])
    if (!dead.length) throw err
    live.retried = true
    for (const oldId of dead) {
      const fileData = sources.get(oldId)
      forget(oldId)
      const newId = await reupload(fileData)
      sources.delete(oldId)
      sources.set(newId, fileData)
      for (const part of live.contentParts || []) {
        if (part?.source?.type === 'file' && part.source.file_id === oldId) part.source.file_id = newId
      }
    }
    console.warn(`[DOG] ${dead.length} file(s) were gone from the AI's store; uploaded again and retried once.`)
    return await call()
  }
}
