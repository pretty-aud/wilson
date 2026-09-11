// =============================================================================
// Resources/ProjectFilesExplorer.jsx — FILES, under RESOURCES (demo
// 2026-09-11).
//
// Audrey, 2026-09-11, verbatim: "in the resource section of the app please
// add a way for me to view all the files in a project. allow me to choose a
// project and have a way to view folders and files. it should look
// something like window explorer. have a way to view all files and folder
// in one table, and also have a view that works like the column system in
// finder for mac os. so idea is one column is one level of folders, then
// the next column is one folder layer in and so on. … make sure to show all
// details for a file like listed before."
//
// Choose a project → its folders (0041's tree, both backends) and files
// (public.files / the local bundle, plus the Local Server's managed files)
// come straight from the adapter — no switch of the active project — and
// fileTree.js turns them into one tree. Two views over that tree: TABLE
// (every folder and file, indented, sortable by any column) and COLUMNS
// (Finder-style: each selected folder opens the next column). A selected
// file shows every detail the row carries: name, type, size, created,
// modified, duration, location, where it is stored.
//
// Read-only on purpose tonight: opening, moving and deleting stay where
// they are (the project's own Files panel and FileManager).
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { LIGHT_INK } from '../lightSurface'
import { formatBytes } from '../../cloud/workspaceStorage'
import { formatDuration } from '../../tools/rabbit_v0.1.0/storage/mediaMetadata'
import { buildFileTree, flattenTree, filterFlat, columnsFor, breadcrumb, sortRows } from './fileTree'

const INK = LIGHT_INK
const MUTED = '#7c4f1f'
const ACCENT = '#ea580c'
const ROW_A = 'rgba(120, 70, 30, 0.12)'
const ROW_B = 'rgba(120, 70, 30, 0.22)'
const SELECTED = 'rgba(234, 88, 12, 0.24)'
const BORDER = '1px solid rgba(120, 70, 30, 0.25)'

const PROVIDER_LABEL = {
  supabase: 'Petal cloud',
  s3: 'Your own bucket',
  local_server: 'This computer',
  local_managed: 'The project folder on this computer',
  google_drive: 'Google Drive',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function safeList(fn, id) {
  if (typeof fn !== 'function') return Promise.resolve([])
  try { return Promise.resolve(fn(id)).then(v => (Array.isArray(v) ? v : [])).catch(() => []) } catch { return Promise.resolve([]) }
}

const btnStyle = (active) => ({
  padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  borderRadius: 2, cursor: 'pointer', border: `1px solid ${active ? ACCENT : 'rgba(120,70,30,0.4)'}`,
  backgroundColor: active ? SELECTED : 'transparent', color: INK,
})

export default function ProjectFilesExplorer() {
  const ctx = useRabbit()
  const projects = useMemo(
    () => Object.values(ctx?.projectsIndex || {}).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })),
    [ctx?.projectsIndex],
  )
  const [projectId, setProjectId] = useState('')
  const activeProjectId = ctx?.activeProjectId
  useEffect(() => {
    // Land on the project that is already open, once, so the page is never blank on arrival.
    if (!projectId && activeProjectId) setProjectId(activeProjectId)
  }, [activeProjectId, projectId])

  const [view, setView] = useState('columns')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [reloads, setReloads] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tree, setTree] = useState(null)
  const [selected, setSelected] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const getAdapter = ctx?.getAdapter

  useEffect(() => {
    if (!projectId) { setTree(null); setError(''); return }
    const adapter = getAdapter?.()
    if (!adapter) return
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      safeList(adapter.listFolders?.bind(adapter), projectId),
      safeList(adapter.listFiles?.bind(adapter), projectId),
      safeList(adapter.listManagedFiles?.bind(adapter), projectId),
    ]).then(([folders, files, managedFiles]) => {
      if (cancelled) return
      setTree(buildFileTree({ folders, files, managedFiles }))
      setSelected([])
      setSelectedFile(null)
      setLoading(false)
    }).catch((err) => {
      if (cancelled) return
      setError(err?.message || 'the project files could not be loaded')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [projectId, getAdapter, reloads])

  const flat = useMemo(() => (tree ? flattenTree(tree.root) : []), [tree])
  const tableRows = useMemo(() => sortRows(filterFlat(flat, query), sortKey, sortDir), [flat, query, sortKey, sortDir])
  const cols = useMemo(() => (tree ? columnsFor(tree.root, selected) : []), [tree, selected])

  const onSort = useCallback((key) => {
    setSortDir(d => (sortKey === key ? (d === 'asc' ? 'desc' : 'asc') : 'asc'))
    setSortKey(key)
  }, [sortKey])

  const openFolder = useCallback((depth, id) => {
    setSelected(prev => [...prev.slice(0, depth), id])
    setSelectedFile(null)
  }, [])
  const pickFile = useCallback((depth, node) => {
    setSelected(prev => prev.slice(0, depth))
    setSelectedFile(node)
  }, [])

  const project = projects.find(p => p.id === projectId) || null

  return (
    <div className="h-full flex flex-col" style={{ color: INK }} data-files-explorer data-view={view}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '18px 24px 12px', borderBottom: BORDER }}>
        <h2 className="text-lg font-bold uppercase tracking-widest" style={{ color: INK, marginRight: 8 }}>Files</h2>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c', minWidth: 240 }}
          aria-label="Project"
        >
          <option value="">Choose a project…</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.title || 'Untitled'}{p.is_private ? ' · private' : ''}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="View">
          <button type="button" style={btnStyle(view === 'table')} onClick={() => setView('table')}>Table</button>
          <button type="button" style={btnStyle(view === 'columns')} onClick={() => setView('columns')}>Columns</button>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or path…"
          className="px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c', minWidth: 220 }}
          aria-label="Filter"
        />
        <button type="button" style={btnStyle(false)} onClick={() => setReloads(n => n + 1)} disabled={!projectId || loading}>Refresh</button>
        {tree && (
          <span style={{ fontSize: 12, color: MUTED, fontFamily: 'monospace' }}>
            {tree.folderCount} folder{tree.folderCount === 1 ? '' : 's'} · {tree.fileCount} file{tree.fileCount === 1 ? '' : 's'}
            {project ? ` · ${project.title}` : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-3 text-xs px-3 py-2 rounded-sm" style={{ backgroundColor: '#1c1917', border: '1px solid #991b1b', color: '#fca5a5' }}>{error}</div>
      )}

      {!projectId && <Empty>Choose a project to see its folders and files.</Empty>}
      {projectId && loading && <Empty>Loading…</Empty>}
      {projectId && !loading && tree && flat.length === 0 && !error && <Empty>No folders or files yet.</Empty>}

      {projectId && !loading && tree && flat.length > 0 && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
            {view === 'table'
              ? <TableView rows={tableRows} sortKey={sortKey} sortDir={sortDir} onSort={onSort} onPick={(node) => setSelectedFile(node)} selectedId={selectedFile?.id || null} query={query} />
              : <ColumnsView cols={cols} selected={selected} selectedFile={selectedFile} onOpenFolder={openFolder} onPickFile={pickFile} />}
          </div>
          <DetailsPanel node={selectedFile} />
        </div>
      )}
    </div>
  )
}

function Empty({ children }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 13, color: MUTED, fontFamily: 'monospace' }}>{children}</div>
  )
}

const HEADERS = [
  ['name', 'Name'], ['type', 'Type'], ['size', 'Size'], ['created', 'Created'],
  ['modified', 'Modified'], ['duration', 'Duration'], ['path', 'Location'],
]

function TableView({ rows, sortKey, sortDir, onSort, onPick, selectedId, query }) {
  const indent = query ? 0 : 1
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-files-table>
      <thead>
        <tr style={{ position: 'sticky', top: 0, backgroundColor: '#f5efe6', zIndex: 1 }}>
          {HEADERS.map(([key, label]) => (
            <th
              key={key}
              onClick={() => onSort(key)}
              style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, cursor: 'pointer', borderBottom: BORDER, whiteSpace: 'nowrap' }}
            >
              {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ node, depth }, i) => {
          const isFolder = node.kind === 'folder'
          const m = node.meta || {}
          const isSel = node.id === selectedId
          return (
            <tr
              key={node.id}
              onClick={() => { if (!isFolder) onPick(node) }}
              data-node-kind={node.kind}
              style={{ backgroundColor: isSel ? SELECTED : (i % 2 === 0 ? ROW_A : ROW_B), cursor: isFolder ? 'default' : 'pointer' }}
            >
              <td style={{ padding: '8px 12px', paddingLeft: 12 + depth * 18 * indent, fontWeight: isFolder ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>
                <span aria-hidden style={{ marginRight: 8 }}>{isFolder ? '▸' : '·'}</span>{node.name}
              </td>
              <td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap' }}>{isFolder ? 'Folder' : m.type}</td>
              <td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{isFolder ? '' : formatBytes(m.sizeBytes)}</td>
              <td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap' }}>{isFolder ? '' : fmtDate(m.createdAt)}</td>
              <td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap' }}>{isFolder ? '' : fmtDate(m.modifiedAt)}</td>
              <td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{isFolder ? '' : formatDuration(m.durationSec)}</td>
              <td style={{ padding: '8px 12px', color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360, fontFamily: 'monospace', fontSize: 11 }}>{isFolder ? node.path : (node.parent && !node.parent.isRoot ? node.parent.path : '')}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ColumnsView({ cols, selected, selectedFile, onOpenFolder, onPickFile }) {
  return (
    <div style={{ display: 'flex', height: '100%', overflowX: 'auto' }} data-files-columns>
      {cols.map((col, depth) => (
        <div key={col.folder ? col.folder.id : depth} style={{ minWidth: 260, maxWidth: 340, borderRight: BORDER, overflowY: 'auto', display: 'flex', flexDirection: 'column' }} data-column={depth}>
          <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, borderBottom: BORDER, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {col.folder && !col.folder.isRoot ? col.folder.name : 'Project'}
          </div>
          {col.items.length === 0 && <div style={{ padding: '14px 12px', fontSize: 12, color: MUTED, fontFamily: 'monospace' }}>Empty</div>}
          {col.items.map((node) => {
            const isFolder = node.kind === 'folder'
            const isSel = isFolder ? selected[depth] === node.id : selectedFile?.id === node.id
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => (isFolder ? onOpenFolder(depth, node.id) : onPickFile(depth, node))}
                data-node-kind={node.kind}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%',
                  padding: '7px 12px', textAlign: 'left', fontSize: 13, color: INK, border: 'none', cursor: 'pointer',
                  backgroundColor: isSel ? SELECTED : 'transparent', fontWeight: isFolder ? 700 : 500,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                {isFolder
                  ? <span aria-hidden style={{ color: MUTED }}>›</span>
                  : <span style={{ color: MUTED, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{formatBytes(node.meta?.sizeBytes)}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function DetailsPanel({ node }) {
  if (!node) {
    return (
      <div style={{ width: 300, borderLeft: BORDER, padding: 16, fontSize: 12, color: MUTED, fontFamily: 'monospace' }} data-file-details="none">
        Select a file to see its details.
      </div>
    )
  }
  const m = node.meta || {}
  const isMedia = m.kind === 'video' || m.kind === 'audio'
  const rows = [
    ['Name', node.name],
    ['Type', m.type || '—'],
    ['Size', formatBytes(m.sizeBytes)],
    ['Created', fmtDate(m.createdAt)],
    ['Modified', fmtDate(m.modifiedAt)],
    ['Duration', isMedia ? (formatDuration(m.durationSec) || 'not read') : '—'],
    ['Location', breadcrumb(node.parent) || 'Project'],
    ['Stored', PROVIDER_LABEL[m.provider] || m.provider || '—'],
  ]
  return (
    <div style={{ width: 300, borderLeft: BORDER, padding: 16, overflowY: 'auto' }} data-file-details={node.id}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>Details</div>
      <dl style={{ margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <dt style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>{k}</dt>
            <dd style={{ margin: 0, fontSize: 13, color: INK, wordBreak: 'break-word' }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
