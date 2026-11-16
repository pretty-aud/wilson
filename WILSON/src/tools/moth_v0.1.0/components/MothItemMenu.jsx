// MothItemMenu.jsx — MO5 (her item 8): what a right-click on a dot of the map or a row of the list offers, and the
// Rename question it can open. Her words: "right click and have options like rename the folders (folders like ASSETS,
// SCENES, etc. that are infrastructural folders cannot be renamed, only direct assets etc.)".
//
// The menu holds what the list's own menus offer there (Open or Open board, New board here) and Rename; a file adds
// Move to… and Delete, as the view panel offers them for what is ticked, and a thing opens in its own tool. Rename is
// for a person's own folder, a board's among them (0138's moth_rename_folder): the folders WILSON makes (a project's
// top, ASSETS, SCENES and their kind, and a thing's own folder, which is named after the thing) are greyed, with
// why; so is a thing, a file or a project, which are renamed in R.A.B.B.I.T. Every entry the person may not use is
// greyed with its reason, never left out, and the server asks again.
import { useEffect, useRef, useState } from 'react'
import { Banner, Button, Dialog } from '../../../ui'

export const RENAME_WORDS = Object.freeze({
  kept: 'WILSON made this folder, so its name stays.',
  thing: (what) => `This folder is named after its ${what}. Rename the ${what} in R.A.B.B.I.T.`,
  project: 'A project is renamed in R.A.B.B.I.T., from its settings.',
  elsewhere: 'Rename this in R.A.B.B.I.T.',
  local: 'Renaming a folder in M.O.T.H. needs this project in the cloud.',
  done: (name) => `Renamed to “${name}”.`,
})
const THING_WORD = { asset: 'asset', scene: 'scene', shot: 'shot', level: 'level', experience: 'experience' }
const CONTAINERS = new Set(['project', 'folder', 'phase', 'scene'])
const kindOf = (id) => String(id).slice(0, String(id).indexOf(':'))
const rowOf = (id) => String(id).slice(String(id).indexOf(':') + 1)

/** Whether a person's own folder may be renamed here, and why not: the folder's kind first, then the page's gate. */
export function renameGate(folder, { gate = { allowed: true }, cloud = true } = {}) {
  if (!folder) return { allowed: false, reason: null }
  if (folder.kind === 'entity') return { allowed: false, reason: RENAME_WORDS.thing(THING_WORD[folder.entity_type] ?? 'thing') }
  if (folder.kind !== 'custom') return { allowed: false, reason: RENAME_WORDS.kept }
  if (!cloud) return { allowed: false, reason: RENAME_WORDS.local }
  if (!gate?.allowed) return { allowed: false, reason: gate?.reason || 'You may not change this project.' }
  return { allowed: true, reason: null }
}

/**
 * The menu for one item (a graph id such as 'folder:…'), as the kit Menu's items: a header naming it, then each
 * entry, a greyed one followed by its reason. `ctx` gives what the page knows and does.
 */
export function itemMenu(id, ctx) {
  const kind = kindOf(id)
  const row = ctx.index?.rows?.get(id)
  if (!row) return []
  const pid = row.projectId ?? (kind === 'project' ? rowOf(id) : null)
  const items = [{ header: ctx.labelOf?.(id) || row.label || '(no name)' }]
  const greyed = (label, reason) => { items.push({ label, disabled: true }); if (reason) items.push({ header: reason }) }

  // Open: a board opens; a container is gone into in the list; anything else is shown there.
  const board = kind === 'folder' ? ctx.boardOf?.(rowOf(id)) : null
  if (board) items.push({ label: 'Open board', onClick: () => ctx.openBoard(board) })
  else if (CONTAINERS.has(kind)) items.push({ label: 'Open', onClick: () => ctx.open(id) })
  else items.push({ label: 'Show in the list', onClick: () => ctx.show(id) })

  // New board here: a project or a folder that is not a board (nor inside one), as the folder's menu offers it.
  if ((kind === 'project' || kind === 'folder') && !board && !(kind === 'folder' && ctx.underBoard?.(pid, rowOf(id)))) {
    const g = ctx.boardGate(pid)
    const start = { projectId: pid, folderId: kind === 'folder' ? rowOf(id) : null }
    if (g.allowed) items.push({ label: 'New board here…', onClick: () => ctx.newBoard(start) })
    else greyed('New board here…', g.reason)
  }

  // A file: Move to… and Delete, as the view panel offers them for what is ticked.
  if (kind === 'file') {
    const f = ctx.fileOf?.(rowOf(id))
    const g = f?.managed ? { allowed: false, reason: ctx.managedWords } : ctx.writeGate(pid)
    if (g.allowed) {
      items.push({ label: 'Move to…', onClick: () => ctx.moveFile(rowOf(id)) })
      items.push({ label: 'Delete…', danger: true, onClick: () => ctx.deleteFile(rowOf(id)) })
    } else {
      items.push({ label: 'Move to…', disabled: true })
      greyed('Delete…', g.reason)
    }
  }

  // Rename.
  if (kind === 'folder') {
    const folder = ctx.folderOf?.(pid, rowOf(id))
    const r = renameGate(folder, { gate: ctx.writeGate(pid), cloud: ctx.cloud })
    if (r.allowed) items.push({ label: board ? 'Rename board…' : 'Rename…', onClick: () => ctx.rename({ id, projectId: pid, folderId: rowOf(id), name: folder?.label || row.label || '' }) })
    else greyed('Rename…', r.reason)
  } else if (kind === 'project') {
    greyed('Rename…', RENAME_WORDS.project)
  } else {
    greyed('Rename…', RENAME_WORDS.elsewhere)
  }

  // A thing (or a note) opens in its own tool.
  const jump = ctx.jumpFor?.(id)
  if (jump) items.push({ label: jump.label, onClick: () => ctx.jump(jump) })
  return items
}

/** The Rename question: the name, kept by Enter or the button, refused in the server's words. */
export function MothRenameDialog({ name: start = '', isBoard = false, onRename, onClose }) {
  const [name, setName] = useState(start)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)
  useEffect(() => { try { ref.current?.focus({ preventScroll: true }); ref.current?.select?.() } catch { /* courtesy */ } }, [])
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
  const go = async () => {
    if (busy || !clean) return
    if (clean === start.trim()) { onClose(); return }
    setBusy(true)
    setError('')
    try {
      await onRename(clean)
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      width="confirm"
      title={isBoard ? 'Rename this board' : 'Rename this folder'}
      onClose={() => { if (!busy) onClose() }}
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={go} disabled={!clean} loading={busy} loadingLabel="Renaming…" data-moth-rename-go>Rename</Button>
        </>
      )}
    >
      <label className="moth-field">
        Name
        <input
          ref={ref}
          className="moth-search"
          type="text"
          value={name}
          maxLength={120}
          disabled={busy}
          onChange={(e) => { setName(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } }}
          data-moth-rename-name
        />
      </label>
      {error && <Banner tone="danger" data-moth-rename-error>{error}</Banner>}
    </Dialog>
  )
}
