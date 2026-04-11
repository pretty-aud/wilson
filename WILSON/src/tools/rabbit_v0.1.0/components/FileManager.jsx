// ============================================================
// RABBIT -- FileManager
// ============================================================
//
// Reusable file table/gallery component for managed files.
// Used in AssetDetailPopup (full CRUD) and TaskEditor (read-only).
//
// Props:
//   files          - array of managed file records
//   assetId        - the asset these files belong to
//   assetName      - display name of the asset
//   projectId      - current project ID
//   project        - project record (for slug, folder_root)
//   mode           - 'full' (asset popup: add/manage/delete)
//                    'readonly' (task popup: add/download only)
//   taskTitle      - if present, auto-name uploaded files after this task
//   taskId         - if present, tag uploaded files with this task id
//   onFileAdded    - callback after a file is added (refreshes parent)
//   onFileDeleted  - callback after a file is deleted
//   onFileUpdated  - callback after a file is updated
//
// UX Laws applied:
//   - Jakob's Law: table/gallery views match familiar file managers
//   - Cognitive Load: auto-naming, auto-versioning reduce decisions
//   - Doherty Threshold: progress bar for large file copies
//   - Chunking: files grouped by asset, properties organized in columns
//   - Fitts's Law: large add button, delete tucked away in full mode only

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Download, Trash2, Table as TableIcon, LayoutGrid,
  FolderOpen, Pencil, X, Check, Loader2,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import FileThumbnail from './FileThumbnail'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${m[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// Slugify matching the server's fileSlugify
function fileSlugify(str) {
  return str.trim()
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('-')
}

export default function FileManager({
  files = [],
  assetId,
  assetName,
  projectId,
  project,
  mode = 'full',
  taskTitle,
  taskId,
  onFileAdded,
  onFileDeleted,
  onFileUpdated,
}) {
  const ctx = useRabbit()
  const [viewMode, setViewMode] = useState('table')
  const [copying, setCopying] = useState(false)
  const [copyProgress, setCopyProgress] = useState(null) // { fileName, percent }
  const [editingNotes, setEditingNotes] = useState(null) // file id
  const [notesDraft, setNotesDraft] = useState('')

  // Filter to only files for this asset, exclude soft-deleted
  const assetFiles = useMemo(() =>
    files.filter(f => f.asset_id === assetId && !f.deleted_at)
      .sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || '')),
    [files, assetId]
  )

  // Listen for copy progress IPC events
  useEffect(() => {
    const api = window.electronAPI?.rabbit
    if (!api?.onCopyProgress) return
    const unsub = api.onCopyProgress((data) => {
      setCopyProgress({ fileName: data.fileName, percent: data.percent })
    })
    return unsub
  }, [])

  // ── Add files handler ──
  const handleAddFiles = useCallback(async () => {
    const api = window.electronAPI?.rabbit
    if (!api) return
    const filePaths = await api.pickFiles()
    if (!filePaths || filePaths.length === 0) return

    setCopying(true)
    setCopyProgress(null)

    try {
      const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')

      for (const srcPath of filePaths) {
        // Get file info
        const stats = await api.getFileStats({ filePath: srcPath })
        if (!stats || !stats.isFile) continue

        const pathParts = srcPath.replace(/\\/g, '/').split('/')
        const originalName = pathParts[pathParts.length - 1]
        const extIdx = originalName.lastIndexOf('.')
        const ext = extIdx >= 0 ? originalName.substring(extIdx) : ''
        const baseName = extIdx >= 0 ? originalName.substring(0, extIdx) : originalName

        // If uploading from a task, use task title as file name
        const fileName = taskTitle || baseName

        // Create manifest record first to get the stored_name with version
        const record = await ctx.addManagedFile({
          asset_id:      assetId,
          task_id:       taskId || null,
          file_name:     fileName,
          original_name: originalName,
          extension:     ext,
          mime_type:     guessMimeType(ext),
          size_bytes:    stats.size,
          notes:         '',
        })

        // Resolve destination directory
        const assetSlug = fileSlugify(assetName || 'Untitled-Asset')
        const folderRoot = project?.folder_root
        let destDir
        if (folderRoot) {
          destDir = folderRoot.replace(/\\/g, '/') + '/' + assetSlug
        } else {
          // Fallback: use the files config default root
          const cfg = await api.readFilesConfig()
          if (cfg?.defaultRootDir) {
            destDir = cfg.defaultRootDir.replace(/\\/g, '/') + '/' + projectSlug + '/' + assetSlug
          }
        }

        if (destDir) {
          // Copy file to asset folder using streaming IPC
          setCopyProgress({ fileName: record.stored_name, percent: 0 })
          await api.copyFile({
            sourcePath: srcPath,
            destDir: destDir.replace(/\//g, '\\'),
            destFileName: record.stored_name,
          })
        }
      }

      onFileAdded?.()
    } catch (err) {
      console.error('File add failed:', err)
    } finally {
      setCopying(false)
      setCopyProgress(null)
    }
  }, [ctx, assetId, assetName, project, taskTitle, taskId, onFileAdded])

  // ── Download handler ──
  const handleDownload = useCallback(async (file) => {
    const api = window.electronAPI?.rabbit
    if (!api) return
    // Open the file's folder in OS explorer
    const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
    const assetSlug = fileSlugify(assetName || 'Untitled-Asset')
    const folderRoot = project?.folder_root
    let filePath
    if (folderRoot) {
      filePath = folderRoot + '\\' + assetSlug + '\\' + file.stored_name
    } else {
      const cfg = await api.readFilesConfig()
      if (cfg?.defaultRootDir) {
        filePath = cfg.defaultRootDir + '\\' + projectSlug + '\\' + assetSlug + '\\' + file.stored_name
      }
    }
    if (filePath) {
      await api.openInExplorer({ filePath: filePath.replace(/\//g, '\\') })
    }
  }, [project, assetName])

  // ── Delete handler ──
  const handleDelete = useCallback(async (file) => {
    if (!window.confirm(`Delete "${file.stored_name}"? This will move the file to trash.`)) return
    try {
      await ctx.deleteManagedFile(file.id, false)
      onFileDeleted?.()
    } catch (err) {
      console.error('File delete failed:', err)
    }
  }, [ctx, onFileDeleted])

  // ── Open folder in explorer ──
  const handleOpenFolder = useCallback(async () => {
    const api = window.electronAPI?.rabbit
    if (!api) return
    const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
    const assetSlug = fileSlugify(assetName || 'Untitled-Asset')
    const folderRoot = project?.folder_root
    let folderPath
    if (folderRoot) {
      folderPath = folderRoot + '\\' + assetSlug
    } else {
      const cfg = await api.readFilesConfig()
      if (cfg?.defaultRootDir) {
        folderPath = cfg.defaultRootDir + '\\' + projectSlug + '\\' + assetSlug
      }
    }
    if (folderPath) {
      await api.openInExplorer({ filePath: folderPath.replace(/\//g, '\\') })
    }
  }, [project, assetName])

  // ── Notes editing ──
  const handleSaveNotes = useCallback(async (fileId) => {
    try {
      await ctx.updateManagedFile(fileId, { notes: notesDraft })
      onFileUpdated?.()
    } catch (err) {
      console.error('Notes update failed:', err)
    }
    setEditingNotes(null)
  }, [ctx, notesDraft, onFileUpdated])

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#fb923c' }}>
            Files ({assetFiles.length})
          </span>
          <button
            type="button"
            onClick={handleOpenFolder}
            className="p-0.5 rounded-sm hover:bg-stone-700 transition-colors"
            title="Open folder in explorer"
            style={{ color: '#a8a29e' }}
          >
            <FolderOpen className="w-3 h-3" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleAddFiles}
            disabled={copying}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm hover:brightness-110 transition-colors"
            style={{
              color: '#fff7ed',
              backgroundColor: '#ea580c',
              border: '1px solid #c2410c',
              opacity: copying ? 0.6 : 1,
            }}
          >
            {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            {copying ? 'Copying...' : 'Add files'}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            title="Table"
            className="p-1 rounded-sm"
            style={{
              color: viewMode === 'table' ? '#fb923c' : '#78716c',
              backgroundColor: viewMode === 'table' ? '#44403c' : 'transparent',
            }}
          >
            <TableIcon className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('gallery')}
            title="Gallery"
            className="p-1 rounded-sm"
            style={{
              color: viewMode === 'gallery' ? '#fb923c' : '#78716c',
              backgroundColor: viewMode === 'gallery' ? '#44403c' : 'transparent',
            }}
          >
            <LayoutGrid className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Copy progress bar */}
      {copyProgress && (
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[9px] font-mono truncate" style={{ color: '#a8a29e', maxWidth: 200 }}>
              {copyProgress.fileName}
            </span>
            <span className="text-[9px] font-mono" style={{ color: '#fb923c' }}>
              {copyProgress.percent}%
            </span>
          </div>
          <div className="w-full rounded-full overflow-hidden" style={{ height: 3, backgroundColor: '#44403c' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${copyProgress.percent}%`, backgroundColor: '#ea580c' }}
            />
          </div>
        </div>
      )}

      {/* Empty state */}
      {assetFiles.length === 0 && !copying && (
        <div className="py-6 text-center">
          <FolderOpen className="w-6 h-6 mx-auto mb-1" style={{ color: '#57534e' }} />
          <span className="text-[11px] font-mono italic" style={{ color: '#78716c' }}>
            No files yet -- click "Add files" to get started.
          </span>
        </div>
      )}

      {/* Table view */}
      {assetFiles.length > 0 && viewMode === 'table' && (
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ backgroundColor: '#44403c' }}>
              <Th />
              <Th>Name</Th>
              <Th>Version</Th>
              <Th>Size</Th>
              <Th>Date</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {assetFiles.map(f => (
              <tr key={f.id} style={{ borderBottom: '1px solid #1c1917', backgroundColor: '#292524' }}>
                <Td>
                  <FileThumbnail file={f} size="small" projectId={projectId} />
                </Td>
                <Td>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-mono truncate" style={{ color: '#d6d3d1', maxWidth: 180 }}>
                      {f.stored_name}
                    </span>
                    {editingNotes === f.id ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <input
                          autoFocus
                          type="text"
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveNotes(f.id)
                            if (e.key === 'Escape') setEditingNotes(null)
                          }}
                          className="flex-1 px-1 py-0.5 text-[9px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                          style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                        />
                        <button onClick={() => handleSaveNotes(f.id)} className="p-0.5 hover:bg-stone-700 rounded-sm" style={{ color: '#86efac' }}>
                          <Check className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={() => setEditingNotes(null)} className="p-0.5 hover:bg-stone-700 rounded-sm" style={{ color: '#fca5a5' }}>
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingNotes(f.id); setNotesDraft(f.notes || '') }}
                        className="text-[9px] font-mono text-left truncate hover:underline"
                        style={{ color: f.notes ? '#a8a29e' : '#57534e', maxWidth: 180 }}
                      >
                        {f.notes || 'Add notes...'}
                      </button>
                    )}
                  </div>
                </Td>
                <Td>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm" style={{ color: '#fb923c', backgroundColor: '#44403c' }}>
                    {f.version_label || 'v001'}
                  </span>
                </Td>
                <Td>
                  <span className="text-[10px] font-mono" style={{ color: '#a8a29e' }}>
                    {formatBytes(f.size_bytes)}
                  </span>
                </Td>
                <Td>
                  <span className="text-[10px] font-mono" style={{ color: '#a8a29e' }}>
                    {formatDate(f.uploaded_at)}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDownload(f)}
                      className="p-1 rounded-sm hover:bg-stone-700"
                      title="Show in explorer"
                      style={{ color: '#a8a29e' }}
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    {mode === 'full' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(f)}
                        className="p-1 rounded-sm hover:bg-stone-700"
                        title="Delete file"
                        style={{ color: '#fca5a5' }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Gallery view */}
      {assetFiles.length > 0 && viewMode === 'gallery' && (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {assetFiles.map(f => (
            <div
              key={f.id}
              className="rounded-sm overflow-hidden flex flex-col"
              style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}
            >
              <div className="flex items-center justify-center" style={{ height: 100, backgroundColor: '#1c1917' }}>
                <FileThumbnail file={f} size="large" projectId={projectId} />
              </div>
              <div className="p-2 flex flex-col gap-0.5">
                <span className="text-[10px] font-mono truncate" style={{ color: '#d6d3d1' }}>
                  {f.file_name}{f.extension}
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono px-1 rounded-sm" style={{ color: '#fb923c', backgroundColor: '#44403c' }}>
                    {f.version_label || 'v001'}
                  </span>
                  <span className="text-[9px] font-mono" style={{ color: '#78716c' }}>
                    {formatBytes(f.size_bytes)}
                  </span>
                </div>
              </div>
              <div
                className="flex items-center justify-center gap-1 py-1"
                style={{ borderTop: '1px solid #44403c', backgroundColor: '#1c1917' }}
              >
                <button
                  type="button"
                  onClick={() => handleDownload(f)}
                  className="p-1 rounded-sm hover:bg-stone-700"
                  title="Show in explorer"
                  style={{ color: '#a8a29e' }}
                >
                  <Download className="w-3 h-3" />
                </button>
                {mode === 'full' && (
                  <button
                    type="button"
                    onClick={() => handleDelete(f)}
                    className="p-1 rounded-sm hover:bg-stone-700"
                    title="Delete file"
                    style={{ color: '#fca5a5' }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Table atoms ──
function Th({ children }) {
  return (
    <th className="px-2 py-1.5 text-[9px] font-mono uppercase tracking-wider text-left" style={{ color: '#fb923c' }}>
      {children}
    </th>
  )
}
function Td({ children }) {
  return <td className="px-2 py-1.5 align-middle">{children}</td>
}

// ── MIME type guesser ──
function guessMimeType(ext) {
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.tiff': 'image/tiff',
    '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.psd': 'image/vnd.adobe.photoshop', '.ai': 'application/postscript',
    '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
    '.fbx': 'application/octet-stream', '.usd': 'application/octet-stream',
    '.ma': 'application/octet-stream', '.blend': 'application/octet-stream',
    '.exr': 'image/x-exr',
  }
  return map[(ext || '').toLowerCase()] || 'application/octet-stream'
}
