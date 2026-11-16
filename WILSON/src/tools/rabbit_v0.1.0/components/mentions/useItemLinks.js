// MO3 (0127): one thing's links, out and in, as the caller may see them (moth_item_links). `out` holds the typed
// links' keys, so a text's tokens can be drawn as links; `in` is the thing's "Mentioned in". On a database before
// 0127, or a project kept on this computer, there are none and `available` is false: the field reads as plain words.
import { useCallback, useEffect, useRef, useState } from 'react'

const EMPTY = Object.freeze({ out: [], in: [] })

export function useItemLinks(getAdapter, kind, id) {
  const [links, setLinks] = useState(EMPTY)
  const [available, setAvailable] = useState(true)
  const seqRef = useRef(0)
  const load = useCallback(async () => {
    const seq = ++seqRef.current
    const a = typeof getAdapter === 'function' ? getAdapter() : null
    if (!kind || !id || typeof a?.listMothItemRelationships !== 'function') { setLinks(EMPTY); setAvailable(false); return }
    try {
      const out = await a.listMothItemRelationships(kind, id)
      if (seq !== seqRef.current) return
      setLinks({ out: out?.out || [], in: out?.in || [] })
      setAvailable(true)
    } catch (err) {
      if (seq !== seqRef.current) return
      setLinks(EMPTY)
      setAvailable(err?.code !== 'moth_absent' ? true : false)
    }
  }, [getAdapter, kind, id])
  useEffect(() => { load() }, [load])
  return { ...links, available, reload: load }
}

/** The links out that a text's keys name, by key. */
export function linksByKey(out) {
  const map = new Map()
  for (const l of out || []) if (l?.key) map.set(l.key, l)
  return map
}
