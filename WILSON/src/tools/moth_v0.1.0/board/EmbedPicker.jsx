// EmbedPicker.jsx — MO4 boards: "Embed a file". A small searchable list of the files this person can see in the
// board's project, read through Moth's own file list (listMothFiles, a page at a time, keyed on the id; the server
// already leaves out money, Legal and whatever else Moth may not show). Left out here: the board's own folder (its
// files are the board's already: its stickies and what was dropped on it) and any file the office server could not
// find. Picking one places it as an embed, a reference to the file where it is, never a copy.
//
// Plain React, no Konva; reached only through BoardCanvas, so it rides in the board's own chunk. While it is open it
// takes Escape first (the panel's Escape stack), and a press anywhere else closes it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { File as FileIcon, Image as ImageIcon, Video, X } from 'lucide-react'
import { IconButton } from '../../../ui'
import { fileTileKind } from './shapes.js'

export const EMBED_TITLE = 'Embed a file'
export const EMBED_LOADING = 'Finding files…'
export const EMBED_EMPTY = 'There are no files to embed in this project yet.'
export const EMBED_NO_MATCH = 'No file has that name.'
export const EMBED_FAILED = 'The files could not be listed just now. Try again in a moment.'
export const embedMoreWords = (shown, total) => `Showing ${shown} of ${total}. Type to narrow the list.`

const PAGE = 500
const MAX_PAGES = 20
const SHOWN = 200
const KIND_ICON = { picture: ImageIcon, video: Video, file: FileIcon }

/** Every page of Moth's file list for a project: a short page is the end, and a page that does not move on is too. */
export async function readProjectFiles(adapter, projectId, { pageSize = PAGE, maxPages = MAX_PAGES } = {}) {
  const out = []
  let after = null
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await adapter.listMothFiles(projectId, after, pageSize)
    const list = Array.isArray(rows) ? rows : []
    out.push(...list)
    if (list.length < pageSize) break
    const last = list[list.length - 1]?.id ?? null
    if (!last || last === after) break
    after = last
  }
  return out
}

/** The board's own folder and every folder below it. */
export function boardFolderSet(boardFolderId, folders = []) {
  const set = new Set(boardFolderId ? [boardFolderId] : [])
  for (let grew = set.size > 0; grew;) {
    grew = false
    for (const f of folders || []) {
      if (f?.id && set.has(f.parent_id) && !set.has(f.id)) { set.add(f.id); grew = true }
    }
  }
  return set
}

/** What a board may embed: each file once, not in the board's own folder, not missing; by name, then id. */
export function embeddableFiles(rows, board, folders = []) {
  const skip = boardFolderSet(board?.folder_id ?? null, folders)
  const seen = new Set()
  const out = []
  for (const f of Array.isArray(rows) ? rows : []) {
    if (!f?.id || seen.has(f.id)) continue
    seen.add(f.id)
    if (f.folder_id && skip.has(f.folder_id)) continue
    if (f.missing === true || f.share_missing_since || f.deleted_at) continue
    out.push(f)
  }
  return out.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' })
    || (String(a.id) < String(b.id) ? -1 : 1))
}

/** The files whose name holds every word typed, in any order, without regard to case. */
export function matchFiles(files, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return files
  return files.filter((f) => {
    const name = String(f.name ?? '').toLowerCase()
    return words.every((w) => name.includes(w))
  })
}

const folderLabel = (f) => String(f?.label || f?.name || f?.slug || f?.path || '').trim()

export default function EmbedPicker({ adapter, board, onPick, onClose, escape = null, inputMode = 'mouse' }) {
  const touch = inputMode === 'touch'
  const [state, setState] = useState({ status: 'loading', files: [], folders: new Map() })
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const projectId = board?.project_id ?? null
  const boardFolder = board?.folder_id ?? null

  useEffect(() => {
    let live = true
    ;(async () => {
      if (!projectId || typeof adapter?.listMothFiles !== 'function') { setState({ status: 'failed', files: [], folders: new Map() }); return }
      try {
        const [rows, folders] = await Promise.all([
          readProjectFiles(adapter, projectId),
          typeof adapter.listMothFolders === 'function' ? Promise.resolve(adapter.listMothFolders(projectId)).catch(() => []) : [],
        ])
        if (!live) return
        const list = Array.isArray(folders) ? folders : []
        setState({
          status: 'ready',
          files: embeddableFiles(rows, { folder_id: boardFolder }, list),
          folders: new Map(list.map((f) => [f.id, folderLabel(f)])),
        })
      } catch {
        if (live) setState({ status: 'failed', files: [], folders: new Map() })
      }
    })()
    return () => { live = false }
  }, [adapter, projectId, boardFolder])

  useEffect(() => {
    try { inputRef.current?.focus({ preventScroll: true }) } catch { inputRef.current?.focus() }
  }, [])

  // The topmost picker takes Escape first.
  useEffect(() => {
    if (typeof escape?.push !== 'function') return undefined
    const pop = escape.push(() => { closeRef.current?.(); return true })
    return () => { if (typeof pop === 'function') pop() }
  }, [escape])

  // A press anywhere else closes it (the toolbar's own button toggles it, so it is not "elsewhere").
  useEffect(() => {
    const away = (e) => {
      const t = e.target
      if (rootRef.current && rootRef.current.contains(t)) return
      if (t && typeof t.closest === 'function' && t.closest('[data-board-embed-toggle]')) return
      closeRef.current?.()
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [])

  const matches = useMemo(() => matchFiles(state.files, query), [state.files, query])
  const shown = matches.slice(0, SHOWN)
  const pick = (f) => { if (f) onPick?.(f) }

  // With the panel's Escape stack the key travels on to the panel, which asks the stack (this list is on top);
  // without one, the list closes itself and the key goes no further.
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || typeof escape?.push === 'function') return
    e.preventDefault()
    e.stopPropagation()
    onClose?.()
  }

  let message = null
  if (state.status === 'loading') message = EMBED_LOADING
  else if (state.status === 'failed') message = EMBED_FAILED
  else if (!state.files.length) message = EMBED_EMPTY
  else if (!matches.length) message = EMBED_NO_MATCH

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={EMBED_TITLE}
      data-moth-board-embed
      data-input={inputMode}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute', top: 12, left: touch ? 76 : 60, zIndex: 5, width: 320, maxWidth: 'calc(100% - 96px)',
        maxHeight: 'calc(100% - 24px)', display: 'flex', flexDirection: 'column', gap: 8, padding: touch ? 12 : 8,
        borderRadius: 10, border: '1px solid var(--color-rule, rgba(0,0,0,0.12))', background: 'var(--color-paper-raised, #fff)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)', color: 'var(--color-ink, #1F2933)', boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1, fontSize: 'var(--text-body)' }}>{EMBED_TITLE}</strong>
        <IconButton size={touch ? 'md' : 'sm'} Icon={X} title="Close" surface="light" onClick={() => onClose?.()} />
      </div>
      <input
        ref={inputRef}
        type="search"
        className="ui-input"
        data-size={touch ? 'md' : 'sm'}
        data-surface="light"
        aria-label="Search files"
        placeholder="Search files"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pick(shown[0]) } }}
      />
      {message && (
        <p role="status" style={{ margin: 0, padding: '4px 2px', fontSize: 'var(--text-dense)', color: 'var(--color-ink-2, #555)' }}>{message}</p>
      )}
      {shown.length > 0 && (
        <ul aria-label="Files" style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {shown.map((f) => {
            const Icon = KIND_ICON[fileTileKind(f)] || FileIcon
            const where = f.folder_id ? state.folders.get(f.folder_id) : ''
            return (
              <li key={f.id}>
                <button
                  type="button"
                  data-embed-file={f.id}
                  onClick={() => pick(f)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: touch ? 44 : 30, padding: '4px 6px',
                    border: 0, borderRadius: 6, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  <Icon size={16} aria-hidden="true" style={{ flex: 'none', color: 'var(--color-ink-2, #555)' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-dense)' }}>{f.name || 'Untitled file'}</span>
                    {where && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-label)', color: 'var(--color-ink-2, #666)' }}>{where}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {matches.length > shown.length && (
        <p style={{ margin: 0, fontSize: 'var(--text-label)', color: 'var(--color-ink-2, #666)' }}>{embedMoreWords(shown.length, matches.length)}</p>
      )}
    </div>
  )
}
