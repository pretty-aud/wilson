// MO3 (0126): a thing's typed tags, as its reader may see them: the company's on it, and the reader's own, marked
// as theirs alone. A tag is taken off by whoever put it there may: the company's by those who may change the thing,
// one's own by oneself. `#` in the thing's text puts one on (useMentionPicker); this shows and removes them.
// Nothing is drawn on a database before 0126, or while the thing has none.
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import './mentions.css'

const ItemTags = forwardRef(function ItemTags({ getAdapter, kind, id, canChange = true }, ref) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const seqRef = useRef(0)
  const load = useCallback(async () => {
    const seq = ++seqRef.current
    const a = typeof getAdapter === 'function' ? getAdapter() : null
    if (!kind || !id || typeof a?.listMothTagAssignments !== 'function' || typeof a?.listMothTags !== 'function') { setRows([]); return }
    try {
      const [assigned, tags] = await Promise.all([a.listMothTagAssignments({ targetKind: kind, targetId: id }), a.listMothTags()])
      if (seq !== seqRef.current) return
      const byId = new Map((tags || []).map(t => [t.id, t]))
      setRows((assigned || []).map(x => ({ ...x, tag: byId.get(x.tag_id) })).filter(x => x.tag))
      setError(null)
    } catch (err) {
      if (seq !== seqRef.current) return
      setRows([])
      if (err?.code !== 'moth_absent') setError(err?.message || 'The tags could not be read.')
    }
  }, [getAdapter, kind, id])
  useEffect(() => { load() }, [load])
  useImperativeHandle(ref, () => ({ reload: load }), [load])

  const remove = useCallback(async (row) => {
    const a = typeof getAdapter === 'function' ? getAdapter() : null
    try {
      const res = await a.unassignMothTag(row.id)
      if (!res?.removed) setError('That tag is not yours to take off.')
      await load()
    } catch (err) {
      setError(err?.message || 'That tag could not be taken off.')
    }
  }, [getAdapter, load])

  if (!rows.length && !error) return null
  return (
    <div className="rb-item-tags" aria-label="Tags">
      {rows.map(r => (
        <span key={r.id} className="rb-item-tag" data-tier={r.tier}>
          <span className="rb-item-tag-label">{r.tag.label}</span>
          {r.tier === 'personal' && <span className="rb-item-tag-mine" title="Only you see this tag here">yours</span>}
          {(r.tier === 'personal' || canChange) && (
            <button type="button" className="rb-item-tag-remove" title={`Take off ${r.tag.label}`} aria-label={`Take off ${r.tag.label}`}
              onClick={() => remove(r)}>×</button>
          )}
        </span>
      ))}
      {error && <span className="rb-item-tags-error" role="status">{error}</span>}
    </div>
  )
})

export default ItemTags
