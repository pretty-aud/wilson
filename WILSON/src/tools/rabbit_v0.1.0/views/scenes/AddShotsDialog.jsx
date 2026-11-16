// ============================================================
// RABBIT — "Add shot…" to an edit (post-overhaul S3c, step 4; D16)
// ============================================================
//
// A row's or a scene's edit actions: tick shots of the LIST and put them in
// the cut — after the row, or at the end of the scene's block. Audrey: an
// edit's shots "can be repeated", so a shot already in the cut is never
// locked: it says how many times it plays ("In the cut ×2") and adding it
// again is a repeat. The groups are AssignToShotDialog's (scene → shots,
// numbered order, omitted shots hidden and counted — the brief), the look
// is Add from another list's (the same picker, Similarity): the kit Dialog
// at the reading width, a search, a native checkbox per row (the kit has
// none), a scene's own box ticking its shots. The button counts what goes in.
// ============================================================

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Film, Clapperboard, ListPlus } from 'lucide-react'
import { Dialog, Button, IconButton, StatusBadge, EmptyState } from '../../../../ui'
import { assignableShotGroups, matchesShotSearch } from '../../bins/shotTakeSelectors'
import '../rabbitScenes.css'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const sceneWords = (sc) => `${sc.scene_number != null ? `Sc ${sc.scene_number} · ` : ''}${sc.name || 'Untitled scene'}`

/**
 * intoWords      what the shots go into: the draft, "“Shoot · v4”", or —
 *                from a saved edit, whose first change asks — "a new
 *                version of “Shoot · v3”"
 * whereWords     where in the cut, "after “The door” (cut 3)"
 * scenes / shots the list's own rows
 * preferSceneId  the scene whose shots come first (the block it goes into)
 * inCut          Map shot id → how many times it plays in the cut now
 * onAdd          async (shotIds, in the order shown) — throws a refusal
 * onClose
 */
export default function AddShotsDialog({ intoWords, whereWords, scenes, shots, preferSceneId = null, inCut, onAdd, onClose }) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { groups, hiddenOmitted } = useMemo(
    () => assignableShotGroups(shots || [], scenes || [], { preferSceneId }),
    [shots, scenes, preferSceneId],
  )
  const shown = useMemo(
    () => groups.map(g => ({ ...g, shots: g.shots.filter(s => matchesShotSearch(s, g.scene, search)) })).filter(g => g.shots.length),
    [groups, search],
  )
  const flip = (ids, on) => setPicked(prev => {
    const next = new Set(prev)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    return next
  })
  const groupState = (g) => {
    const on = g.shots.filter(s => picked.has(s.id)).length
    return on === 0 ? 'none' : on === g.shots.length ? 'all' : 'some'
  }
  // In the order shown, not the order ticked: the cut reads as the list does.
  const ordered = groups.flatMap(g => g.shots).filter(s => picked.has(s.id)).map(s => s.id)

  async function add() {
    if (busy || !ordered.length) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(ordered)
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  const total = groups.reduce((n, g) => n + g.shots.length, 0)
  return createPortal(
    <Dialog
      width="reading"
      className="wilson-dark-scroll"
      title="Add shots to the edit"
      subtitle={`Into ${intoWords}, ${whereWords}. A shot added twice plays twice.${hiddenOmitted ? ` ${plural(hiddenOmitted, 'omitted shot')} hidden.` : ''}`}
      busy={busy}
      error={error}
      onClose={onClose}
      footer={(
        <>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" Icon={ListPlus} loading={busy} disabled={!ordered.length} onClick={add}>
            {ordered.length ? `Add ${plural(ordered.length, 'shot')}` : 'Add'}
          </Button>
        </>
      )}
    >
      <div className="rb-scene-addfrom-bar">
        <span className="rb-scene-addfrom-search">
          <Search className="rb-scene-addfrom-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="ui-input rb-scene-addfrom-search-input"
            data-size="sm"
            value={search}
            autoFocus
            placeholder="Search shots…"
            aria-label="Search shots"
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape' && search) { e.preventDefault(); setSearch('') } }}
          />
          {search && <IconButton size="sm" Icon={X} title="Clear the search" className="rb-scene-addfrom-search-clear" onClick={() => setSearch('')} />}
        </span>
      </div>

      <div className="rb-scene-addfrom-list" role="group" aria-label="The list's shots">
        {shown.length === 0 ? (
          <EmptyState
            Icon={search.trim() ? Search : Film}
            title={search.trim() ? `Nothing matches “${search.trim()}”` : 'This list has no shots yet'}
            body={total === 0 && !search.trim() ? 'Add shots to the list first, or use New shot in the edit actions.' : undefined}
          />
        ) : shown.map(g => {
          const state = groupState(g)
          return (
            <div key={g.key} className="rb-scene-addfrom-group">
              <label className="rb-scene-addfrom-row rb-scene-addfrom-scene">
                <input
                  type="checkbox"
                  checked={state === 'all'}
                  ref={el => { if (el) el.indeterminate = state === 'some' }}
                  disabled={busy}
                  onChange={() => flip(g.shots.map(s => s.id), state !== 'all')}
                />
                <Film className="rb-scene-addfrom-glyph" aria-hidden="true" />
                <span className="rb-scene-addfrom-name">{g.scene ? sceneWords(g.scene) : 'Shots without a scene'}</span>
                <span className="rb-scene-addfrom-note">{plural(g.shots.length, 'shot')}</span>
              </label>
              {g.shots.map(sh => {
                const times = inCut?.get(sh.id) || 0
                return (
                  <label key={sh.id} className="rb-scene-addfrom-row rb-scene-addfrom-shot">
                    <input
                      type="checkbox"
                      checked={picked.has(sh.id)}
                      disabled={busy}
                      onChange={() => flip([sh.id], !picked.has(sh.id))}
                    />
                    <Clapperboard className="rb-scene-addfrom-glyph" aria-hidden="true" />
                    <span className="rb-scene-addfrom-num">{`#${sh.shot_number ?? '—'}`}</span>
                    <span className="rb-scene-addfrom-name">{sh.name || 'Untitled shot'}</span>
                    <StatusBadge status={sh.status || 'not_started'} />
                    <span className="rb-scene-addfrom-note">{times ? (times === 1 ? 'In the cut' : `In the cut ×${times}`) : ''}</span>
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
