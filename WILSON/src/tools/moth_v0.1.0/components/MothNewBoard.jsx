// MothNewBoard.jsx — MO5 (her item 3): a board's name and where it goes, asked in one dialog. The New board button in
// M.O.T.H.'s top strip opens it, as does New board in a project's or a folder's menu. It starts on the folder the person
// has selected (or the one the list is inside), and lists every project they can see with its folders, indented under
// their parents: the project's top, its ASSETS, SCENES and other folders, a thing's own folder (an asset's, a scene's)
// and the person's own folders. A board is never made inside another board, so a board's folder and what is below it
// are left out. A project the person may not change stays in the list, greyed, and says why; so does a place the
// server then refuses, in its own words.
//
// Reads only what Moth already holds (the catalogue's folders, which never carry money or Legal); the server asks again
// at the make (0130's board_create, 0138's for a thing's own folder).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Banner, Button, Dialog } from '../../../ui'
import { islandLabel } from './MothIslands.jsx'

export const TOP_WORDS = 'Top of the project'
export const NO_PLACE_WORDS = 'There is no project you may change, so there is nowhere to make a board yet.'
const INDENT = '   '

/**
 * A project's folders as the picker lists them: the top first, then each folder after its parent (by path), with its
 * depth. A board's own folder (`isBoard(id)`) and everything below it are left out.
 */
export function boardPlaces(folders, isBoard = () => false) {
  const rows = (Array.isArray(folders) ? folders : []).filter((f) => f && f.id != null)
  const byId = new Map(rows.map((f) => [String(f.id), f]))
  const underBoard = (f) => {
    for (let x = f, n = 0; x && n < 64; x = x.parent_id != null ? byId.get(String(x.parent_id)) : null, n++) {
      if (isBoard(String(x.id))) return true
    }
    return false
  }
  const out = [{ id: null, label: TOP_WORDS, depth: 0, kind: 'root' }]
  rows
    .filter((f) => f.kind !== 'root' && !(f.parent_id == null && String(f.path ?? '') === '') && !underBoard(f))
    .sort((a, b) => String(a.path ?? '').localeCompare(String(b.path ?? ''), undefined, { sensitivity: 'base' }))
    .forEach((f) => out.push({
      id: String(f.id),
      label: f.label || f.slug || '(no name)',
      depth: Math.max(1, String(f.path ?? '').split('/').filter(Boolean).length),
      kind: f.kind,
    }))
  return out
}

/** The project and folder a new board starts on, from what is selected; a board's own folder starts on its parent. */
export function startPlace({ start, islands, foldersOf, isBoard = () => false, gateOf = () => ({ allowed: true }) }) {
  const pid = start?.projectId != null ? String(start.projectId) : null
  const isle = pid ? (islands || []).find((r) => String(r.id) === pid) : null
  if (isle) {
    const rows = foldersOf(pid) || []
    const byId = new Map(rows.map((f) => [String(f.id), f]))
    let fid = start.folderId != null ? String(start.folderId) : null
    // Out of a board (and of anything below one), up to the folder that holds it.
    for (let n = 0; fid && n < 64; n++) {
      const f = byId.get(fid)
      if (!f) { fid = null; break }
      let inside = false
      for (let x = f, m = 0; x && m < 64; x = x.parent_id != null ? byId.get(String(x.parent_id)) : null, m++) if (isBoard(String(x.id))) { inside = true; fid = x.parent_id != null ? String(x.parent_id) : null; break }
      if (!inside) break
    }
    if (fid && byId.get(fid)?.kind === 'root') fid = null
    return { projectId: pid, folderId: fid }
  }
  const first = (islands || []).find((r) => gateOf(String(r.id)).allowed)
  return { projectId: first ? String(first.id) : null, folderId: null }
}

export default function MothNewBoard({ islands = [], foldersOf = () => [], isBoard = () => false, gateOf = () => ({ allowed: true }), start = null, localOnly = false, onMake, onClose }) {
  const first = useMemo(() => startPlace({ start, islands, foldersOf, isBoard, gateOf }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(first.projectId)
  const [folderId, setFolderId] = useState(first.folderId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef(null)
  useEffect(() => { try { nameRef.current?.focus({ preventScroll: true }) } catch { /* focus is a courtesy */ } }, [])

  const places = useMemo(() => (projectId ? boardPlaces(foldersOf(projectId), isBoard) : []), [projectId, foldersOf, isBoard])
  const gate = projectId ? gateOf(projectId) : { allowed: false, reason: NO_PLACE_WORDS }
  const anyAllowed = islands.some((r) => gateOf(String(r.id)).allowed)
  const canMake = !busy && !!projectId && gate.allowed
  const make = async () => {
    if (!canMake) return
    setBusy(true)
    setError('')
    try {
      await onMake({ projectId, folderId: folderId || null, title: title.trim() })
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      width="confirm"
      title="New board"
      onClose={() => { if (!busy) onClose() }}
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={make} disabled={!canMake} loading={busy} loadingLabel="Making…" data-moth-board-make>Make the board</Button>
        </>
      )}
    >
      <label className="moth-field">
        Name
        <input
          ref={nameRef}
          className="moth-search"
          type="text"
          value={title}
          maxLength={120}
          placeholder="Board"
          disabled={busy}
          onChange={(e) => { setTitle(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); make() } }}
          data-moth-board-name
        />
      </label>
      <label className="moth-field">
        Project
        <select value={projectId ?? ''} disabled={busy} onChange={(e) => { setProjectId(e.target.value || null); setFolderId(null); setError('') }} data-moth-board-project>
          {!projectId && <option value="">Choose a project…</option>}
          {islands.map((row) => {
            const g = gateOf(String(row.id))
            return (
              <option key={row.id} value={String(row.id)} disabled={!g.allowed}>
                {islandLabel(row, { localOnly })}{g.allowed ? '' : ' (you may not change it)'}
              </option>
            )
          })}
        </select>
      </label>
      <label className="moth-field">
        Where it goes
        <select value={folderId ?? ''} disabled={busy || !projectId || !gate.allowed} onChange={(e) => { setFolderId(e.target.value || null); setError('') }} data-moth-board-folder>
          {places.map((p) => (
            <option key={p.id ?? 'top'} value={p.id ?? ''}>{INDENT.repeat(p.depth)}{p.label}</option>
          ))}
        </select>
      </label>
      {!anyAllowed && <p className="moth-quiet" data-moth-board-nowhere>{NO_PLACE_WORDS}</p>}
      {anyAllowed && projectId && !gate.allowed && <p className="moth-quiet" data-moth-board-why>{gate.reason || 'You may not change this project.'}</p>}
      {error && <Banner tone="danger" data-moth-board-make-error>{error}</Banner>}
    </Dialog>
  )
}
