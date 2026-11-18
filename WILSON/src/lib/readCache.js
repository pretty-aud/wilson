// =============================================================================
// readCache.js — one read shared by every reader of the same thing (F5, the
// review's shared B1 and B2: the roster and the rate card).
//
// A keyed, module-level cache that React reads through useSyncExternalStore,
// as heldSession.js and activeModel.js are: no provider and no state library.
//
//   * One entry per key: { data, loading, error, loaded }. Readers that mount
//     together share ONE read: `ensure` starts a read only when the entry has
//     no answer and none is under way.
//   * A generation per entry: an answer to a read that a newer read (a
//     reload, an event) overtook, or whose entry was dropped, lands nowhere.
//     A slow answer never overwrites a newer one.
//   * The key carries the PERSON as well as the company (F4's rule: nothing
//     of the first person's reaches the next), and the source (`sourceId`: the
//     adapter object, so a switched adapter is a new entry). A reader asks for
//     its own key only, so it is never handed another key's rows, even for a
//     frame, and `retain` drops every entry of anyone else.
//   * An entry lives while it has readers: when the last one unsubscribes it
//     is dropped a microtask later (StrictMode's unsubscribe and resubscribe
//     inside one commit keep it), and the next reader reads it afresh. The
//     readers' listeners are held apart from the entries, so dropping an
//     entry never silences a reader still mounted on its key.
// =============================================================================
import { useCallback, useSyncExternalStore } from 'react'

const IDLE = Object.freeze({ data: undefined, loading: false, error: null, loaded: false })

const sourceIds = new WeakMap()
let nextSourceId = 1
/** A stable small id for an object (an adapter), for a cache key; 0 for none. */
export function sourceId(obj) {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return 0
  let id = sourceIds.get(obj)
  if (!id) { id = nextSourceId++; sourceIds.set(obj, id) }
  return id
}

// `empty` is what an edit starts from on an entry with no answer (a read that
// failed): the edit shows, as it did on each reader's own state before F5.
export function createReadCache({ empty } = {}) {
  const entries = new Map() // key → { snap, gen, promise, online, at }
  const subs = new Map()    // key → Set of the readers' listeners

  const emit = (key) => {
    for (const l of [...(subs.get(key) || [])]) {
      try { l() } catch { /* a reader must not break the cache */ }
    }
  }
  const sweep = (key) => {
    queueMicrotask(() => {
      if (!subs.get(key)?.size) entries.delete(key)
    })
  }
  const entryOf = (key) => {
    let e = entries.get(key)
    if (!e) {
      e = { snap: IDLE, gen: 0, promise: null, online: undefined, at: 0 }
      entries.set(key, e)
      sweep(key) // a read nobody subscribes to is not kept
    }
    return e
  }
  const live = (key, e, gen) => entries.get(key) === e && e.gen === gen

  function read(key, reader) {
    const e = entryOf(key)
    const gen = ++e.gen
    e.snap = Object.freeze({ ...e.snap, loading: true, error: null })
    emit(key)
    const p = (async () => {
      try {
        const data = await reader()
        if (!live(key, e, gen)) return
        e.snap = Object.freeze({ data, loading: false, error: null, loaded: true })
        e.at = Date.now()
      } catch (err) {
        if (!live(key, e, gen)) return
        e.snap = Object.freeze({ ...e.snap, loading: false, error: err?.message || String(err) })
      } finally {
        if (live(key, e, gen)) {
          e.promise = null
          emit(key)
        }
      }
    })()
    e.promise = p
    return p
  }

  return {
    subscribe(key, listener) {
      if (key == null) return () => {}
      let set = subs.get(key)
      if (!set) { set = new Set(); subs.set(key, set) }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) {
          if (subs.get(key) === set) subs.delete(key)
          sweep(key)
        }
      }
    },
    /** The entry as it stands, never reading: IDLE for a key with none. */
    peek(key) {
      return (key != null && entries.get(key)?.snap) || IDLE
    },
    /** Read the entry unless it has an answer or a read is under way. */
    ensure(key, reader) {
      if (key == null) return Promise.resolve()
      const e = entryOf(key)
      if (e.promise) return e.promise
      if (e.snap.loaded) return Promise.resolve()
      return read(key, reader)
    },
    /**
     * A reader that mounts after the answer it would share is older than
     * `maxAgeMs` reads it again (one read, shared by every reader), so a view
     * opened later sees what the server says now, a revoked grant included
     * (F5's first review round). Readers that mount together share one read.
     */
    revalidate(key, reader, maxAgeMs) {
      if (key == null) return Promise.resolve()
      const e = entryOf(key)
      if (e.promise) return e.promise
      if (!e.snap.loaded) return read(key, reader)
      if (Date.now() - e.at > maxAgeMs) return read(key, reader)
      return Promise.resolve()
    },
    /** Read it again now; an answer still on its way is dropped. */
    reload(key, reader) {
      if (key == null) return Promise.resolve()
      return read(key, reader)
    },
    /**
     * Back online after a failed read: read once more, however many readers
     * report the transition. A first read is `ensure`'s, and an answer that
     * stands is kept (the realtime channel's re-join re-reads what changed).
     */
    noteOnline(key, online, reader) {
      if (key == null || typeof online !== 'boolean') return
      const e = entries.get(key)
      if (!e) return
      const was = e.online
      e.online = online
      if (online && was === false && !e.promise && e.snap.error) read(key, reader)
    },
    /** Change the held answer in place (an optimistic write, its rollback). */
    mutate(key, fn) {
      const e = entries.get(key)
      if (!e) return false
      if (!e.snap.loaded && empty === undefined) return false
      e.snap = Object.freeze({ ...e.snap, data: fn(e.snap.loaded ? e.snap.data : (e.snap.data ?? empty)) })
      emit(key)
      return true
    },
    setError(key, error) {
      const e = entries.get(key)
      if (!e || e.snap.error === error) return
      e.snap = Object.freeze({ ...e.snap, error })
      emit(key)
    },
    /** Drop every entry whose key `keep` refuses (another person's, a company left). */
    retain(keep) {
      for (const k of [...entries.keys()]) {
        if (keep(k)) continue
        entries.delete(k)
        emit(k)
      }
    },
    /** Test seam. */
    clear() {
      const keys = [...entries.keys()]
      entries.clear()
      for (const k of keys) emit(k)
    },
  }
}

/** React: the entry for `key` (IDLE for null), re-rendering when it changes. */
export function useReadEntry(cache, key) {
  const subscribe = useCallback((listener) => cache.subscribe(key, listener), [cache, key])
  const get = useCallback(() => cache.peek(key), [cache, key])
  return useSyncExternalStore(subscribe, get, get)
}
