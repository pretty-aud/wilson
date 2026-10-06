// ============================================================
// RABBIT — "Add from another list…" (post-overhaul S3b, step 6)
// ============================================================
//
// The bar's More menu, for the list on screen: tick scenes and shots another
// list holds — or no list, or any in the project — and add them, LINKED (the
// same rows, D1 + D3), through S3a's addToShotList. AssignToShotDialog's
// pattern (Bins: "Assign to shot…"): the kit Dialog at the reading width;
// a source, then a search; the rows grouped scene → shots, each a native
// checkbox (the kit has none). A scene's own box ticks the scene and every
// shot under it that can be added — mixed while only some are — and a shot
// whose scene the list lacks brings its scene along (S3a's planAddToList).
// A row the list already holds is greyed, its box off, and says so. Ticks
// survive a change of source, so rows from two lists go in together; the
// button counts what will be ADDED: the scenes not yet on screen (ticked,
// or brought by a shot) and the shots. A refusal lands in the Dialog's
// error slot in the backend's words, and the ticks stay.
// ============================================================

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Film, Clapperboard, ListPlus } from 'lucide-react'
import { Dialog, Button, IconButton, StatusBadge, EmptyState } from '../../../../ui'
import '../rabbitScenes.css'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const sceneWords = (sc) => `${sc.scene_number != null ? `Sc ${sc.scene_number} · ` : ''}${sc.name || 'Untitled scene'}`

/** The button's words: what will be added. */
export function addLabel({ scenes, shots }) {
  if (!scenes && !shots) return 'Add'
  if (!shots) return `Add ${plural(scenes, 'scene')}`
  if (!scenes) return `Add ${plural(shots, 'shot')}`
  return `Add ${plural(scenes, 'scene')} and ${plural(shots, 'shot')}`
}

/**
 * targetLabel  the list on screen, "Shoot · v1"
 * sources      [{ key, label }] — the other live lists, then "Not in any
 *              list", then every scene and shot
 * defaultFrom  the source it opens on (the first with something to add)
 * rowsOf       (key) => { scenes, shots }, each in the source's order
 * inList       { scenes: Set, shots: Set } — what the list on screen holds
 * sceneById / shotById   S3a's, over every row
 * onAdd        async ({ sceneIds, shotIds }) — throws a refusal
 * onClose
 */
export default function AddFromListDialog({ targetLabel, sources, defaultFrom, rowsOf, inList, sceneById, shotById, onAdd, onClose }) {
  const [from, setFrom] = useState(defaultFrom ?? sources[0]?.key ?? null)
  const [search, setSearch] = useState('')
  const [scenesPicked, setScenesPicked] = useState(() => new Set())
  const [shotsPicked, setShotsPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // The source's rows, scene → shots, in its own order. A shot whose scene
  // the source does not hold (an unlisted shot of a listed scene) still sits
  // under its scene's heading; one with no scene, at the end.
  const groups = useMemo(() => {
    const { scenes = [], shots = [] } = from == null ? {} : rowsOf(from)
    const byScene = new Map(scenes.map(sc => [sc.id, { key: sc.id, scene: sc, shots: [] }]))
    const loose = { key: 'no-scene', scene: null, shots: [] }
    for (const sh of shots) {
      const sc = sh.scene_id ? (byScene.get(sh.scene_id)?.scene || sceneById?.(sh.scene_id)) : null
      if (!sc) { loose.shots.push(sh); continue }
      if (!byScene.has(sc.id)) byScene.set(sc.id, { key: sc.id, scene: sc, shots: [] })
      byScene.get(sc.id).shots.push(sh)
    }
    return [...byScene.values(), ...(loose.shots.length ? [loose] : [])]
  }, [from, rowsOf, sceneById])

  // The search: a scene that matches shows all its shots; otherwise only
  // the shots that match. Names, and numbers as typed.
  const needle = search.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!needle) return groups
    const hit = (name, num) => String(name || '').toLowerCase().includes(needle) || (num != null && String(num) === needle)
    const out = []
    for (const g of groups) {
      if (g.scene && hit(g.scene.name, g.scene.scene_number)) { out.push(g); continue }
      const shots = g.shots.filter(s => hit(s.name, s.shot_number))
      if (shots.length) out.push({ ...g, shots })
    }
    return out
  }, [groups, needle])

  // What will be added: picked scenes not on screen, the scenes picked shots
  // bring, and the picked shots not on screen.
  const adding = useMemo(() => {
    const scenes = new Set([...scenesPicked].filter(id => !inList.scenes.has(id)))
    let shots = 0
    for (const id of shotsPicked) {
      if (inList.shots.has(id)) continue
      shots += 1
      const sid = shotById?.(id)?.scene_id
      if (sid && !inList.scenes.has(sid)) scenes.add(sid)
    }
    return { scenes: scenes.size, shots }
  }, [scenesPicked, shotsPicked, inList, shotById])

  const flip = (set, setSet, ids, on) => setSet(() => {
    const next = new Set(set)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    return next
  })
  /** A scene's box: its own state from what under it can still be added. */
  const groupState = (g) => {
    const sceneOpen = !!g.scene && !inList.scenes.has(g.scene.id)
    const open = g.shots.filter(s => !inList.shots.has(s.id))
    const total = open.length + (sceneOpen ? 1 : 0)
    const on = open.filter(s => shotsPicked.has(s.id)).length + (sceneOpen && scenesPicked.has(g.scene.id) ? 1 : 0)
    return { sceneOpen, open, total, state: on === 0 ? 'none' : on === total ? 'all' : 'some' }
  }
  const toggleGroup = (g) => {
    const { sceneOpen, open, state } = groupState(g)
    const on = state !== 'all'
    if (sceneOpen) flip(scenesPicked, setScenesPicked, [g.scene.id], on)
    flip(shotsPicked, setShotsPicked, open.map(s => s.id), on)
  }

  async function add() {
    if (busy || (!adding.scenes && !adding.shots)) return
    setBusy(true)
    setError(null)
    try {
      await onAdd({ sceneIds: [...scenesPicked], shotIds: [...shotsPicked] })
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  const sourceLabel = sources.find(s => s.key === from)?.label || ''

  return createPortal(
    <Dialog
      width="reading"
      className="wilson-dark-scroll"
      title="Add from another list"
      subtitle={`Into “${targetLabel}”: the same scenes and shots, linked — not copied. Renaming one, or changing its status, changes it in every list.`}
      busy={busy}
      error={error}
      onClose={onClose}
      footer={(
        <>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" Icon={ListPlus} loading={busy} disabled={!adding.scenes && !adding.shots} onClick={add}>
            {addLabel(adding)}
          </Button>
        </>
      )}
    >
      <div className="rb-scene-addfrom-bar">
        <label className="rb-scene-addfrom-from">
          <span className="ui-field-label">From</span>
          <select className="ui-input" data-size="sm" value={from ?? ''} onChange={e => setFrom(e.target.value)}>
            {sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <span className="rb-scene-addfrom-search">
          <Search className="rb-scene-addfrom-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="ui-input rb-scene-addfrom-search-input"
            data-size="sm"
            value={search}
            autoFocus
            placeholder="Search scenes and shots…"
            aria-label="Search scenes and shots"
            onChange={e => setSearch(e.target.value)}
            // A search to clear first: the first Escape empties it, marked
            // handled so the Dialog stays (K4's mark); the next closes.
            onKeyDown={e => { if (e.key === 'Escape' && search) { e.preventDefault(); setSearch('') } }}
          />
          {search && <IconButton size="sm" Icon={X} title="Clear the search" className="rb-scene-addfrom-search-clear" onClick={() => setSearch('')} />}
        </span>
      </div>

      <div className="rb-scene-addfrom-list" role="group" aria-label={`Scenes and shots in ${sourceLabel}`}>
        {shown.length === 0 ? (
          <EmptyState
            Icon={needle ? Search : Film}
            title={needle ? `Nothing matches “${search.trim()}”` : 'No scenes or shots here'}
          />
        ) : shown.map(g => {
          const { total, state } = groupState(g)
          // Nothing under it left to add: ticked and greyed, as a shot the
          // list holds is.
          const allIn = total === 0
          return (
            <div key={g.key} className="rb-scene-addfrom-group">
              <label className="rb-scene-addfrom-row rb-scene-addfrom-scene" data-locked={allIn ? 'true' : undefined}>
                <input
                  type="checkbox"
                  checked={allIn || state === 'all'}
                  ref={el => { if (el) el.indeterminate = state === 'some' }}
                  disabled={busy || allIn}
                  onChange={() => toggleGroup(g)}
                />
                <Film className="rb-scene-addfrom-glyph" aria-hidden="true" />
                <span className="rb-scene-addfrom-name">{g.scene ? sceneWords(g.scene) : 'Shots without a scene'}</span>
                <span className="rb-scene-addfrom-note">
                  {allIn ? 'In this list' : `${plural(g.shots.length, 'shot')}`}
                </span>
              </label>
              {g.shots.map(sh => {
                const held = inList.shots.has(sh.id)
                return (
                  <label key={sh.id} className="rb-scene-addfrom-row rb-scene-addfrom-shot" data-locked={held ? 'true' : undefined}>
                    <input
                      type="checkbox"
                      checked={held || shotsPicked.has(sh.id)}
                      disabled={busy || held}
                      onChange={() => flip(shotsPicked, setShotsPicked, [sh.id], !shotsPicked.has(sh.id))}
                    />
                    <Clapperboard className="rb-scene-addfrom-glyph" aria-hidden="true" />
                    <span className="rb-scene-addfrom-num">{`#${sh.shot_number ?? '—'}`}</span>
                    <span className="rb-scene-addfrom-name">{sh.name || 'Untitled shot'}</span>
                    <StatusBadge status={sh.status || 'not_started'} />
                    <span className="rb-scene-addfrom-note">{held ? 'In this list' : ''}</span>
                  </label>
                )
              })}
            </div>
          )
        })}
      </div>
    </Dialog>,
    document.body,
  )
}
