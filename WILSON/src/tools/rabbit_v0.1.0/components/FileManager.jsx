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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Plus, Download, Trash2, Table as TableIcon, LayoutGrid,
  FolderOpen, Pencil, X, Check, Loader2,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import FileThumbnail from './FileThumbnail'
import { fileSlugify } from '../entityNaming'

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

// Session 25: this was a third verbatim copy of fileSlugify, carrying the
// comment "Slugify matching the server's fileSlugify" — which names the hazard
// exactly. S26 builds the folder tree off these slugs, and a slug that
// disagrees between two renderer files creates two folders for one scene.
// One copy now lives in ../entityNaming.js alongside the naming it belongs to.
// The remaining duplicate is electron/main.cjs, which cannot import from here.

export default function FileManager({
  files = [],
  assetId,
  assetName,
  shotId,
  shotName,
  sceneId,
  sceneName,
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
  const [uploadError, setUploadError] = useState(null)
  const cloudInputRef = useRef(null)

  // ── Session 27: WHICH file store is behind this component ──────────────
  //
  // 🚨 This used to be `window.electronAPI?.rabbit`, and that was the bug.
  // That test is true whenever WILSON runs as a desktop app — including when
  // the SELECTED backend is Supabase. So in cloud mode the Add files button
  // called ctx.addManagedFile, which throws "Managed files require the Local
  // Server backend", and handleAddFiles' own early return meant that on the
  // web it did not even get that far. Files were unreachable from every entity
  // surface in cloud: assets, scenes, shots and the task editor.
  //
  //   managed (local_server + desktop) — versioned records beside real files
  //     on disk, added through a native picker and a streaming copy.
  //   cloud   (everything else)        — `files` rows + the rabbit-files
  //     bucket, added through a plain <input type="file">. S24 established
  //     that this works everywhere, Electron's renderer being Chromium.
  //
  // One component, two stores, because the alternative is two file managers
  // that drift.
  const managed = ctx?.supportsManagedFiles === true

  // Filter to only files for this parent, exclude soft-deleted.
  //
  // The predicate is IDENTICAL for both stores, which is not a coincidence:
  // migration 0043 gave `files` the scene_id/shot_id columns this component
  // had always filtered on. They existed only in the local JSON store before,
  // so in cloud this matched nothing and showed an empty list rather than an
  // error — which is why nobody found it.
  const parentType = sceneId ? 'SCENES' : shotId ? 'SHOTS' : 'ASSETS'
  const parentName = sceneName || shotName || assetName
  const sourceFiles = managed ? files : (ctx?.files || [])
  const assetFiles = useMemo(() =>
    sourceFiles.filter(f => {
      if (f.deleted_at) return false
      // Invoices are manager-only and have their own surface. RLS already
      // hides them from anyone who cannot see them, but a manager WOULD get
      // them here, filed under whatever entity the budget line belonged to.
      if (f.is_financial) return false
      if (sceneId) return f.scene_id === sceneId
      if (shotId) return f.shot_id === shotId
      return f.asset_id === assetId
    }).sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || '')),
    [sourceFiles, assetId, shotId, sceneId]
  )

  // The two stores name things differently: managed records carry a versioned
  // stored_name, cloud rows carry the original name. One accessor rather than
  // a conditional at every render site.
  const displayName = (f) => f.stored_name || f.name || 'file'

  const uploadScope = useMemo(() => ({
    sceneId: sceneId || null,
    shotId:  shotId  || null,
    assetId: assetId || null,
    taskId:  taskId  || null,
  }), [sceneId, shotId, assetId, taskId])

  // Listen for copy progress IPC events
  useEffect(() => {
    const api = window.electronAPI?.rabbit
    if (!api?.onCopyProgress) return
    const unsub = api.onCopyProgress((data) => {
      setCopyProgress({ fileName: data.fileName, percent: data.percent })
    })
    return unsub
  }, [])

  // ── Add files: cloud (Session 27) ──
  //
  // A plain <input type="file">, the same choice InvoiceAttachment made in
  // S24 — Electron's renderer is Chromium, so the desktop bridge was never
  // needed to pick a file and requiring it is what made this desktop-only.
  const handleAddCloudFiles = useCallback(async (fileList) => {
    if (!fileList?.length || !ctx?.uploadFile) return
    setCopying(true)
    setUploadError(null)
    try {
      for (const file of Array.from(fileList)) {
        // taskTitle renaming is a managed-store behaviour: those records carry
        // a separate file_name and a version label. A cloud row keeps the real
        // filename, which is also what gets downloaded.
        await ctx.uploadFile(file, uploadScope)
      }
      onFileAdded?.()
    } catch (err) {
      // 🚨 LOUD. The old managed path swallowed everything into console.error,
      // so a refused upload looked exactly like a successful one that produced
      // no row. RLS refusals are the common case here (a reviewer, a project
      // they cannot write to) and the user has to be told which.
      setUploadError(err?.message || String(err))
    } finally {
      setCopying(false)
    }
  }, [ctx, uploadScope, onFileAdded])

  // ── Add files: managed / Local Server ──
  const handleAddManagedFiles = useCallback(async () => {
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
          asset_id:      assetId || null,
          shot_id:       shotId || null,
          scene_id:      sceneId || null,
          task_id:       taskId || null,
          file_name:     fileName,
          original_name: originalName,
          extension:     ext,
          mime_type:     guessMimeType(ext),
          size_bytes:    stats.size,
          notes:         '',
        })

        // Resolve destination directory
        const parentSlug = fileSlugify(parentName || (shotId ? 'Untitled-Shot' : 'Untitled-Asset'))
        const folderRoot = project?.folder_root
        let destDir
        if (folderRoot) {
          destDir = folderRoot.replace(/\\/g, '/') + '/' + parentType + '/' + parentSlug
        } else {
          // Fallback: the root this machine resolves under. effectiveRootDir
          // (S34) folds in the workspace root when one is pushed — reading
          // defaultRootDir alone here diverged from main's resolvers the day
          // the root moved to the database.
          const cfg = await api.readFilesConfig()
          const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir
          if (rootBase) {
            destDir = rootBase.replace(/\\/g, '/') + '/' + projectSlug + '/' + parentType + '/' + parentSlug
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
      setUploadError(err?.message || String(err))
    } finally {
      setCopying(false)
      setCopyProgress(null)
    }
  }, [ctx, assetId, shotId, parentName, parentType, project, taskTitle, taskId, onFileAdded])

  // ── Download: cloud (Session 27) ──
  // The managed path below opens an OS explorer window at the file's folder,
  // which only means anything when the file is on this machine. A cloud file
  // is a blob in a bucket, so this actually downloads it.
  const handleCloudDownload = useCallback(async (file) => {
    if (!ctx?.downloadFile) return
    setUploadError(null)
    let url
    try {
      const blob = await ctx.downloadFile(file)
      url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = displayName(file)
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      setUploadError(err?.message || String(err))
    } finally {
      // Revoking synchronously can cancel the download in some browsers; a
      // tick after the click is enough and never leaks the object URL.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
  }, [ctx])

  // ── Download handler (managed) ──
  const handleDownload = useCallback(async (file) => {
    const api = window.electronAPI?.rabbit
    if (!api) return
    // Open the file's folder in OS explorer
    const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
    const pSlug = fileSlugify(parentName || (shotId ? 'Untitled-Shot' : 'Untitled-Asset'))
    const folderRoot = project?.folder_root
    let filePath
    if (folderRoot) {
      filePath = folderRoot + '\\' + parentType + '\\' + pSlug + '\\' + file.stored_name
    } else {
      const cfg = await api.readFilesConfig()
      const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir // S34: workspace root first
      if (rootBase) {
        filePath = rootBase + '\\' + projectSlug + '\\' + parentType + '\\' + pSlug + '\\' + file.stored_name
      }
    }
    if (filePath) {
      await api.openInExplorer({ filePath: filePath.replace(/\//g, '\\') })
    }
  }, [project, parentName, parentType, shotId])

  // ── Delete handler ──
  const handleDelete = useCallback(async (file) => {
    const label = displayName(file)
    if (!window.confirm(
      managed
        ? `Delete "${label}"? This will move the file to trash.`
        : `Delete "${label}"? It can be restored by an admin.`
    )) return
    try {
      // Cloud deletes are SOFT (0014) — deleteFile sets deleted_at and the
      // blob is deliberately left in place so a restore has something to
      // restore. Managed deletes go to the OS trash. The confirm copy differs
      // because the promise being made to the user differs.
      if (managed) await ctx.deleteManagedFile(file.id, false)
      else await ctx.deleteFile(file.id)
      onFileDeleted?.()
    } catch (err) {
      setUploadError(err?.message || String(err))
    }
  }, [ctx, managed, onFileDeleted])

  // ── Open folder in explorer ──
  const handleOpenFolder = useCallback(async () => {
    const api = window.electronAPI?.rabbit
    if (!api) return
    const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
    const pSlug = fileSlugify(parentName || (shotId ? 'Untitled-Shot' : 'Untitled-Asset'))
    const folderRoot = project?.folder_root
    let folderPath
    if (folderRoot) {
      folderPath = folderRoot + '\\' + parentType + '\\' + pSlug
    } else {
      const cfg = await api.readFilesConfig()
      const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir // S34: workspace root first
      if (rootBase) {
        folderPath = rootBase + '\\' + projectSlug + '\\' + parentType + '\\' + pSlug
      }
    }
    if (folderPath) {
      await api.openInExplorer({ filePath: folderPath.replace(/\//g, '\\') })
    }
  }, [project, parentName, parentType, shotId])

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
          {/* Opening an OS explorer window only means anything when the file
              is on this machine. In cloud mode there is no folder to open, so
              the control is absent rather than present and inert. */}
          {managed && (
            <button
              type="button"
              onClick={handleOpenFolder}
              className="p-0.5 rounded-sm hover:bg-stone-700 transition-colors"
              title="Open folder in explorer"
              style={{ color: '#a8a29e' }}
            >
              <FolderOpen className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* The cloud picker. Hidden input + a button, so the button can look
              identical in both modes. */}
          {!managed && (
            <input
              ref={cloudInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                handleAddCloudFiles(e.target.files)
                e.target.value = ''
              }}
            />
          )}
          <button
            type="button"
            onClick={() => (managed ? handleAddManagedFiles() : cloudInputRef.current?.click())}
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
            {copying ? (managed ? 'Copying...' : 'Uploading...') : 'Add files'}
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

      {/* 🚨 A refused upload used to reach console.error and nothing else, so
          "nothing happened" covered both an RLS refusal and a successful
          upload that produced no row. On this surface the common refusal is a
          real permission answer — a reviewer, or a project the user cannot
          write to — and it has to say so. */}
      {uploadError && (
        <div
          className="mb-2 px-2 py-1 rounded-sm text-[10px] font-mono"
          style={{ color: '#fca5a5', backgroundColor: 'rgba(220,38,38,0.12)', border: '1px solid #7f1d1d' }}
        >
          {uploadError}
        </div>
      )}

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
                      {displayName(f)}
                    </span>
                    {/* Notes are a managed-record field. `files` has no notes
                        column, and inventing one for a field nobody has asked
                        for is how schema debt starts — so the editor is absent
                        in cloud rather than saving into nothing. */}
                    {!managed ? null : editingNotes === f.id ? (
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
                  {/* Versioning belongs to the managed store, which mints a
                      stored_name per version. A cloud row has no version, and
                      printing "v001" on every one of them would be a confident
                      lie about a feature that is not there. */}
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm" style={{ color: '#fb923c', backgroundColor: '#44403c' }}>
                    {f.version_label || (managed ? 'v001' : '--')}
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
                      onClick={() => (managed ? handleDownload(f) : handleCloudDownload(f))}
                      className="p-1 rounded-sm hover:bg-stone-700"
                      title={managed ? 'Show in explorer' : 'Download'}
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
                  {displayName(f)}
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono px-1 rounded-sm" style={{ color: '#fb923c', backgroundColor: '#44403c' }}>
                    {f.version_label || (managed ? 'v001' : '--')}
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
                  onClick={() => (managed ? handleDownload(f) : handleCloudDownload(f))}
                  className="p-1 rounded-sm hover:bg-stone-700"
                  title={managed ? 'Show in explorer' : 'Download'}
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
