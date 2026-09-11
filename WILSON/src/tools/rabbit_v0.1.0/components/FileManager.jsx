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
import FileThumbnail, { extensionOf } from './FileThumbnail'
import VideoPreview from './VideoPreview'
import { fileSlugify } from '../entityNaming'
// Session 40 (§5f). Provider-keyed, because 50 MB is `rabbit-files`'s own limit
// and applies to PETAL workspaces only — an s3 workspace takes ~5 GB from the
// same browser, so a blanket "too large, use the desktop app" is a false
// refusal for exactly the customers already paying for their own storage.
import { classifyUpload, noticeAfterUpload, summarizeBatch } from '../storage/uploadNotices'
import { activeWorkspaceProvider } from '../storage'
import { localMediaUrl } from '../storage/localServerProvider'
import { hasLocalServer } from '../../../lib/localData'
import { getWorkspaceStorageCached, fetchStorageUsage } from '../../../cloud/workspaceStorage'
import { ensureManagedVideoThumbnail } from '../storage/managedVideoThumbnail'
import { isVideoExtension } from '../storage/videoThumbnails'

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

  // ── Session 40 (§5f): the three situations, and only one of them stops ────
  //
  // `refusedFiles` drives a DIALOG, because an over-cap upload has no result to
  // show and the user must do something different. `batchNotice` is the one
  // summary line. The per-row note is derived at render from the row itself
  // rather than held here — see the render sites — so it survives a reload
  // instead of vanishing the moment the component remounts.
  const [refusedFiles, setRefusedFiles] = useState(null) // string[] of messages
  const [batchNotice, setBatchNotice] = useState(null)
  // true | false | null. Whether THIS machine's desktop app has a
  // professional-codec decoder. null on the web, which cannot ask — and there
  // the "add it from the desktop app" pointer stands, because shipping that
  // decoder is the plan. `false` is measured, and drops the pointer: sending
  // someone to install an app that will fail the same way is worse than
  // saying nothing.
  const [desktopDecoder, setDesktopDecoder] = useState(null)
  // Session 40 (§5d.2): which row's video is open in the player, if any.
  const [previewFile, setPreviewFile] = useState(null)

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

  // Session 40: does THIS machine have the professional-codec decoder?
  //
  // 🚨 DELIBERATELY NOT GATED ON `managed`, and gating it was a real defect
  // (adversarial review). Every READER of `desktopDecoder` is a `!managed`
  // path — `rowNotice` returns null for managed rows, and `classifyUpload`
  // runs on the cloud upload — so probing only when `managed` measured it
  // exactly where nothing reads it and left it permanently `null` everywhere
  // it is used, making the `desktopDecoder === false` arm unreachable.
  //
  // The case that matters is precisely the ungated one: the DESKTOP app in
  // CLOUD mode, which serves this route AND takes the cloud upload path. On
  // the web there is no such route; the response is not JSON, `.json()`
  // rejects, and `desktopDecoder` stays `null` — which is the honest answer
  // for a surface that cannot ask.
  useEffect(() => {
    let cancelled = false
    fetch('/api/rabbit/video-support')
      // 🚨 fetch RESOLVES for every status. An unchecked `.json()` here would
      // read a 404's body as junk and leave `ffmpeg` undefined — which is
      // falsy, so a missing ROUTE would report as a missing DECODER, and the
      // notice would stop pointing at a desktop app that works fine.
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setDesktopDecoder(d.ffmpeg === true) })
      .catch(() => { /* unknown stays unknown, and unknown keeps the pointer */ })
    return () => { cancelled = true }
  }, [])

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

  // Session 40 (§5f): the per-row note, DERIVED rather than remembered.
  //
  // 🚨 A PURE FUNCTION OF THE ROW, which is what makes it survive a reload. The
  // obvious implementation — stash notices in state when the upload returns —
  // shows the note once and then loses it the moment the popup remounts, so the
  // video with no preview looks identical to every other file the next time
  // anyone opens the asset.
  //
  // ⚠️ CLOUD ROWS ONLY. A managed record has no `thumbnail_url` column at all
  // (its preview is an on-disk JPEG in the desktop cache, keyed by id), so
  // asking this question of one would answer "no preview" for every video
  // including the ones that have a perfectly good cached frame. The managed
  // tier says it at add-time through the batch line instead.
  const rowNotice = (f) => (managed ? null : noticeAfterUpload(f, { desktopDecoder }))

  // Session 40 (§5d.2): a video row's thumbnail becomes the play button.
  //
  // Keyed on the EXTENSION, via extensionOf — which reads `extension` on a
  // managed record and derives it from the name on a cloud row, where there is
  // no extension column at all. That absence is the same one that made every
  // cloud thumbnail invisible before S39, so it gets one accessor rather than
  // a second guess here.
  const isVideoRow = (f) => isVideoExtension(extensionOf(f))

  const uploadScope = useMemo(() => ({
    sceneId: sceneId || null,
    shotId:  shotId  || null,
    assetId: assetId || null,
    taskId:  taskId  || null,
  }), [sceneId, shotId, assetId, taskId])

  // Session 39: signed display URLs for the cloud thumbnails on screen.
  //
  // 🚨 SIGNED IN ONE BATCH, keyed by object path, because rabbit-thumbnails is
  // private (0053 — a public bucket would be TPN-CLOUD-004 repeated for
  // pre-release frames). Only rows that HAVE a thumbnail_url are asked for, so
  // a list of documents costs nothing.
  //
  // Keys RLS refuses simply do not come back, so an invoice's thumbnail
  // silently falls through to a file-type icon for anyone without the money
  // seat. That is the gate doing its job, not an error to surface.
  // ⚠️ S44: ONLY PETAL-HOSTED PREVIEWS ARE ASKED FOR. Since S44 a thumbnail
  // lives at its body's provider (Audrey, 2026-08-08 — a still frame IS the
  // content, so it must not sit on Petal's infrastructure when its source does
  // not). An s3 row's preview is in the CUSTOMER's bucket; signing it needs a
  // batch presign that does not exist yet, and no S3 workspace exists on any
  // environment to verify one against, so display is its own session.
  //
  // Filtering here rather than letting createSignedUrls miss them is the
  // difference between a STATED behaviour and a lookup that quietly finds
  // nothing: those tiles fall through to file-type icons, and this line is
  // where the deferred work reconnects — carry the provider, and the arm that
  // presigns s3 keys slots in beside the supabase one.
  //
  // 🚨 THE TEST IS `!== 's3'`, NOT `=== 'supabase'`, AND THE THREE COPIES OF
  // THIS MAPPING MUST AGREE. Where a preview lives is:
  //
  //     s3             -> the customer's bucket   (not signable from here)
  //     everything else -> rabbit-thumbnails       (signable)
  //
  // — the same expression as 0054's thumbnail arm and the teardown sweep's
  // `.neq('storage_provider','s3')`. A `local_server` or `google_drive` row CAN
  // carry a Petal-hosted preview (0053 widened the purge trigger for exactly
  // that case), and `=== 'supabase'` would refuse to display a preview that is
  // sitting right there and perfectly signable. S44 shipped that mistake in the
  // teardown sweep, caught it, and its own review then found the same shape
  // surviving here.
  const [thumbUrls, setThumbUrls] = useState(() => new Map())
  // Demo 2026-09-11: a PRIVATE project's previews live on THIS computer, at
  // a URL the desktop's own server serves (electron/localMedia.cjs) —
  // nothing to sign, and nothing a browser could show (off the desktop they
  // fall through to file-type icons). Split out before the signing round
  // trip and merged back into the same map the two render sites read.
  const localThumbs = useMemo(
    () => (hasLocalServer()
      ? assetFiles
        .filter(f => f.storage_provider === 'local_server' && f.thumbnail_url)
        .map(f => [f.thumbnail_url, localMediaUrl(f.thumbnail_url)])
      : []),
    [assetFiles],
  )
  const thumbKeys = useMemo(
    () => assetFiles
      .filter(f => f.storage_provider !== 's3')
      .filter(f => f.storage_provider !== 'local_server')
      .map(f => f.thumbnail_url)
      .filter(Boolean),
    [assetFiles],
  )
  // 🚨 DEPEND ON THE METHOD, NOT ON `ctx`. RabbitProvider builds its context
  // with a useMemo whose deps include `bundle`, `presentUsers` and
  // `realtimeStatus`, so `ctx` gets a new identity on any state change at all —
  // a collaborator's presence ping, an unrelated optimistic update. Depending
  // on the whole object re-signs every visible thumbnail on each of those, and
  // because a fresh signed URL is a new `src`, every tile RELOADS. The
  // useCallback'd method is stable.
  const signThumbnails = ctx?.thumbnailUrls
  useEffect(() => {
    const local = new Map(localThumbs)
    if (!signThumbnails || thumbKeys.length === 0) {
      setThumbUrls(local)
      return
    }
    let cancelled = false
    signThumbnails(thumbKeys).then(map => {
      // The list can change while a signing round trip is in flight; a late
      // response must not overwrite a newer one.
      if (!cancelled) setThumbUrls(new Map([...local, ...map]))
    })
    return () => { cancelled = true }
    // thumbKeys is memoised on assetFiles, so this re-signs when the list
    // changes and not on every render.
  }, [signThumbnails, thumbKeys, localThumbs])

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
    // 🚨 SNAPSHOT THE FILES SYNCHRONOUSLY, BEFORE ANY await. THIS LINE'S
    // POSITION IS THE WHOLE FEATURE. The picker's onChange does
    // `handleAddCloudFiles(e.target.files); e.target.value = ''`, and MEASURED
    // in Electron 33's own Chromium: `input.files` returns ONE FileList object
    // that `value = ''` empties IN PLACE — {sameObject: true, afterLength: 0}.
    // So the moment this function suspends on an await, the caller's reset runs
    // first and the FileList this function is holding becomes empty.
    //
    // Before S40 the first statement inside the try was
    // `for (const file of Array.from(fileList))`, which read the list
    // synchronously. S40 introduced an `await getWorkspaceStorageCached()`
    // ahead of it for the §5f provider read, which moved the read into a
    // microtask — and turned EVERY cloud upload, on the beta and on
    // desktop-in-cloud-mode, into a silent no-op: no rows, no error, no
    // console output, just a spinner that stops. Found by the pre-push
    // adversarial review; the wiring tests could not see it because they grep
    // source text and this is an ordering property.
    const incoming = Array.from(fileList)
    setCopying(true)
    setUploadError(null)
    setBatchNotice(null)
    setRefusedFiles(null)
    try {
      // §5f. Which provider this workspace is on decides the ceiling, so the
      // read comes first.
      //
      // 🚨 A FAILED READ MUST NOT INVENT A REFUSAL. getWorkspaceStorageCached
      // THROWS rather than guessing, and uploadFile makes the same call and
      // will refuse with its own sentence — so the right behaviour here is to
      // skip the size gate entirely and let the real attempt produce the real
      // error. Defaulting to 'petal' would refuse a 200 MB file on an s3
      // workspace that would have taken it happily.
      let provider = null
      try {
        provider = activeWorkspaceProvider(await getWorkspaceStorageCached())
      } catch { provider = null }

      // Session 41: the Petal-cloud plan, so an over-quota or suspended company
      // gets a sentence instead of a raw RLS error.
      //
      // ⚠️ BOTH OF THESE AWAITS ARE SAFE ONLY BECAUSE THEY ARE HERE — after
      // `const incoming = Array.from(fileList)` above, which is the line whose
      // POSITION is the whole feature. Read that comment before moving either.
      //
      // 🚨 A FAILED READ MUST NOT INVENT A REFUSAL, for the same reason as the
      // provider read: fetchStorageUsage returns null rather than throwing, and
      // classifyUpload treats null as "say nothing". The restrictive policy is
      // the authority and will refuse if it must — refusing HERE on the strength
      // of a query that did not answer would block uploads the server would
      // have taken.
      let storagePlan = null
      try {
        storagePlan = await fetchStorageUsage()
      } catch { storagePlan = null }

      const refused = []
      const queued = []
      const notices = []
      // 🚨 THE PLAN FIGURE IS READ ONCE; THE POLICY RE-EVALUATES ON EVERY INSERT.
      // So a batch that CROSSES the ceiling is refused by the server for its
      // tail, while a loop judging every file against the snapshot taken before
      // the first upload blocks nothing — and the user gets exactly the raw RLS
      // string this feature exists to replace. Project this batch's own bytes
      // forward as we go.
      //
      // ⚠️ SESSION 42 REVERSED THE RULE THIS COMMENT USED TO STATE. The server
      // predicate is now `used + incoming <= quota` (migration 0057), so
      // classifyUpload DOES weigh the file being judged — and this cursor still
      // carries only the bytes of files queued AHEAD of it, because those are
      // the ones the snapshot could not know about. The two together reproduce
      // the server's arithmetic for every file in the batch.
      //
      // The projection still ignores the derived thumbnail bytes that
      // workspace_petal_bytes does meter, so it fires slightly LATE rather than
      // early — deliberately, on the standing rule that a client which refuses
      // what the server would accept is worse than one that lets the server
      // speak.
      let planCursor = storagePlan
      for (const file of incoming) {
        if (!provider) { queued.push(file); continue }
        const verdict = classifyUpload(file, {
          workspaceProvider: provider, desktopDecoder, storagePlan: planCursor,
        })
        // 🚨 ONLY `blocked` STOPS ANYTHING. The other notes ride along with a
        // file that uploads perfectly well — a warning that prevents a working
        // action is worse than the limitation it warns about.
        if (verdict.blocked) {
          // A quota refusal names no file, so without this a thirty-clip batch
          // adds thirty identical sentences to the dialog — the noise
          // uploadNotices' own header exists to prevent. A `too_large` message
          // DOES name its file, so those still list individually.
          if (!refused.includes(verdict.message)) refused.push(verdict.message)
          continue
        }
        notices.push(...verdict.notes.filter(n => n.code === 'slow'))
        queued.push(file)
        if (planCursor) {
          planCursor = {
            ...planCursor,
            usedBytes: planCursor.usedBytes + (Number(file?.size) || 0),
          }
        }
      }
      if (refused.length) setRefusedFiles(refused)

      // 🚨 ONE FILE'S FAILURE MUST NOT ABANDON THE REST. A single throw used to
      // exit the whole loop, so a batch of thirty clips where the fourth was
      // refused left twenty-six never attempted — with one error message and
      // nothing saying which files landed. The user cannot tell what to retry.
      const failed = []
      for (const file of queued) {
        try {
        // taskTitle renaming is a managed-store behaviour: those records carry
        // a separate file_name and a version label. A cloud row keeps the real
        // filename, which is also what gets downloaded.
        // 🚨 SESSION 42 — THE BAR THE RESUMABLE PATH WAS BUILT TO FEED.
        //
        // The brief named progress as one of three things this path had to
        // bring, and until this line the whole chain existed with NO CALLER:
        // putResumable accepted onProgress, supabaseProvider.put forwarded it,
        // and the only upload call site passed nothing. That is the repo's
        // costliest pattern, and the review caught it here rather than in
        // production.
        //
        // Reuses the exact `copyProgress` surface the managed path already
        // renders — same shape, same bar — so a cloud upload and a Local Server
        // copy look identical to the person watching. Only the resumable
        // transport reports, so a small upload shows no bar rather than a fake
        // one that jumps 0 → 100.
        const row = await ctx.uploadFile(file, uploadScope, {
          onProgress: (sent, total) => {
            if (!total) return
            setCopyProgress({
              fileName: file?.name || 'file',
              percent: Math.min(100, Math.round((sent / total) * 100)),
            })
          },
        })
        // Clear between files so a fast small upload after a slow large one
        // does not leave the previous file's bar sitting at 100%.
        setCopyProgress(null)
        // 🚨 THE ACCURATE ANSWER, and it replaces the extension heuristic
        // rather than joining it. The upload path already loaded this file
        // into a <video> and seeked it; a video row that came back with no
        // thumbnail_url means the browser genuinely could not decode it. That
        // is the same decoder answering the same question, not a guess.
        // `attempted: true` — WE JUST WATCHED THE DECODE. This is the one call
        // site entitled to the accurate claim; the render-time rowNotice below
        // deliberately omits it, because it cannot know whether a null
        // thumbnail_url means "the browser refused this codec" or "this row
        // predates S40, when video was refused outright".
        const after = noticeAfterUpload(row, { desktopDecoder, attempted: true })
        if (after) notices.push(after)
        } catch (err) {
          // Named per file, so "which ones failed" is answerable.
          failed.push(`${file?.name || 'a file'}: ${err?.message || String(err)}`)
          // ...and the bar must not be left frozen at whatever percent the
          // upload died on, which would read as "still working".
          setCopyProgress(null)
        }
      }
      if (failed.length) setUploadError(failed.join('\n'))
      setBatchNotice(summarizeBatch(notices))
      onFileAdded?.()
    } catch (err) {
      // 🚨 LOUD. The old managed path swallowed everything into console.error,
      // so a refused upload looked exactly like a successful one that produced
      // no row. RLS refusals are the common case here (a reviewer, a project
      // they cannot write to) and the user has to be told which.
      setUploadError(err?.message || String(err))
    } finally {
      setCopying(false)
      // The per-file clears above cannot run if the OUTER try threw (a failed
      // provider read, say), and a bar left on screen after the spinner stops
      // is the one state that reads as "still uploading" when nothing is.
      setCopyProgress(null)
    }
  }, [ctx, uploadScope, onFileAdded, desktopDecoder])

  // ── Add files: managed / Local Server ──
  const handleAddManagedFiles = useCallback(async () => {
    const api = window.electronAPI?.rabbit
    if (!api) return
    const filePaths = await api.pickFiles()
    if (!filePaths || filePaths.length === 0) return

    setCopying(true)
    setCopyProgress(null)
    setBatchNotice(null)

    // Session 40: collected across the batch so thirty clips produce ONE line,
    // not thirty. §5f: "a confirmation that appears every time is a
    // confirmation nobody reads."
    const videoNotices = []

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

          // ── Session 40: the still frame, AFTER the copy ──────────────────
          //
          // 🚨 A MANAGED FILE HAS NO `File` OBJECT. It arrives through
          // rabbit:pick-files → rabbit:copy-file, a path-to-path stream in the
          // main process, so the renderer never holds the bytes — which is why
          // this cannot reuse the cloud path's generate-from-memory step and
          // has to run once the file exists on disk.
          //
          // ⚠️ AND THIS DOES NOT GENERALISE TO CLOUD. Reading a file back to
          // make a thumbnail costs NOTHING here — it is a local disk read
          // through the loopback server. The same shape against a cloud body
          // means re-downloading the source: Petal egress on a `petal`
          // workspace, a presign round trip plus customer egress on an `s3`
          // one. That is the one expensive design §12.7b forbids, and it is why
          // the cloud arm generates from the copy already in memory.
          if (isVideoExtension(ext)) {
            const made = await ensureManagedVideoThumbnail({
              projectId,
              fileId: record.id,
              extension: ext,
            })
            if (made.ok) {
              // 'renderer' means ffmpeg was not there to do it, so this machine
              // has no professional-codec decoder. Recording it keeps the §5f
              // notice from pointing at a desktop app that would fail the
              // same way.
              if (made.via === 'renderer') setDesktopDecoder(false)
            } else if (made.reason === 'undecodable') {
              videoNotices.push({
                code: 'no_preview',
                message: 'Preview images aren\'t available for this format.',
              })
            }
          }
        }
      }

      setBatchNotice(summarizeBatch(videoNotices))
      onFileAdded?.()
    } catch (err) {
      setUploadError(err?.message || String(err))
    } finally {
      setCopying(false)
      setCopyProgress(null)
    }
  }, [ctx, assetId, shotId, parentName, parentType, project, projectId, taskTitle, taskId, onFileAdded])

  // ── Download: cloud (Session 27) ──
  // The managed path below opens an OS explorer window at the file's folder,
  // which only means anything when the file is on this machine. A cloud file
  // is a blob in a bucket, so this actually downloads it.
  // 🚨 SESSION 42 — THE SIGNED URL COMES FIRST, AND IT IS NOT AN OPTIMISATION.
  //
  // The Blob path below buffers the ENTIRE object into the renderer before a
  // byte reaches disk. Migration 0057 raised the upload ceiling from 50 MiB to
  // 50 GiB and left this untouched, so the product could accept files it could
  // never give back — a customer's 12 GB master would land, bill monthly, and
  // crash the tab on every attempt to retrieve it. Found by this session's
  // pre-deploy review; it was the one finding that could lose data.
  //
  // The signed URL hands the transfer to the browser's own download manager:
  // no memory ceiling, and it starts immediately instead of after a long,
  // silent buffer.
  //
  // ⚠️ NO `a.download` ON THIS BRANCH, DELIBERATELY. The attribute is IGNORED
  // for a cross-origin URL, and a signed Supabase URL always is one. The
  // filename and the attachment behaviour both ride on Content-Disposition,
  // which the adapter sets through createSignedUrl's `download` option —
  // setting the attribute here would look like it was doing the work and would
  // hide the fact that removing that option breaks the filename.
  //
  // The Blob path stays as the fallback for a provider that cannot sign (s3
  // today), so nothing that works now stops working.
  const handleCloudDownload = useCallback(async (file) => {
    if (!ctx?.downloadFile) return
    setUploadError(null)
    let url
    try {
      const signed = ctx.downloadUrl
        ? await ctx.downloadUrl(file, displayName(file))
        : null
      if (signed) {
        const a = document.createElement('a')
        a.href = signed
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
        return
      }

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
      // tick after the click is enough and never leaks the object URL. Only the
      // Blob branch creates one.
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

      {/* ── Session 40 (§5f): ONE summary line per batch, never per file ────
          "Someone dragging in thirty clips would face thirty dialogs and learn
          to dismiss them without reading — which loses the one case that was a
          genuine failure." Informational styling, deliberately not the red the
          error banner above uses: nothing here failed. */}
      {batchNotice && (
        <div
          className="mb-2 px-2 py-1 rounded-sm text-[10px] font-mono flex items-start justify-between gap-2"
          style={{ color: '#fcd34d', backgroundColor: 'rgba(234,179,8,0.10)', border: '1px solid #78350f' }}
        >
          <span>{batchNotice}</span>
          <button
            type="button"
            onClick={() => setBatchNotice(null)}
            className="p-0.5 rounded-sm hover:bg-stone-700 shrink-0"
            style={{ color: '#a8a29e' }}
            title="Dismiss"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      )}

      {/* ── Session 40 (§5f): the ONE case that is a real stop ──────────────
          Over the cap, so the upload genuinely fails and there is no result to
          show. A dialog is right here and wrong for the other two. One dialog
          for the whole batch, listing every refusal — not one per file. */}
      {refusedFiles?.length > 0 && (
        <div
          className="mb-2 px-2 py-1.5 rounded-sm text-[10px] font-mono"
          style={{ color: '#fca5a5', backgroundColor: 'rgba(220,38,38,0.12)', border: '1px solid #7f1d1d' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              {refusedFiles.map((m, i) => <span key={i}>{m}</span>)}
            </div>
            <button
              type="button"
              onClick={() => setRefusedFiles(null)}
              className="p-0.5 rounded-sm hover:bg-stone-700 shrink-0"
              style={{ color: '#fca5a5' }}
              title="Dismiss"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
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
            {assetFiles.map(f => {
              // 🚨 BOUND ONCE PER ROW, NOT DUPLICATED PER BRANCH. Writing the
              // element out in both arms of the video test would give this file
              // three FileThumbnail sites for two render surfaces — and the
              // wiring suite counts them, deliberately, because "the grid card
              // was forgotten" is exactly the shape S39 shipped. It must also
              // NOT become a component defined in render: a fresh component
              // TYPE every render remounts the subtree, throwing away
              // FileThumbnail's erroredSrc memory and reloading every tile.
              const tile = (
                <FileThumbnail
                  file={f}
                  size="small"
                  projectId={projectId}
                  thumbnailUrl={thumbUrls.get(f.thumbnail_url) || null}
                />
              )
              return (
              <tr key={f.id} style={{ borderBottom: '1px solid #1c1917', backgroundColor: '#292524' }}>
                <Td>
                  {/* §5d.2: on a video row the tile IS the play control. A
                      separate button would need its own column on a table that
                      is already tight, and the still frame is the obvious
                      affordance — it is a frame OF the thing it plays. */}
                  {isVideoRow(f) ? (
                    <button
                      type="button"
                      onClick={() => setPreviewFile(f)}
                      title={`Play ${displayName(f)}`}
                      className="block"
                    >
                      {tile}
                    </button>
                  ) : tile}
                </Td>
                <Td>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-mono truncate" style={{ color: '#d6d3d1', maxWidth: 180 }}>
                      {displayName(f)}
                    </span>
                    {/* §5f: an inline note on the affected row. Does not block
                        anything and never has — the file uploaded fine. */}
                    {rowNotice(f) && (
                      <span
                        className="text-[9px] font-mono truncate"
                        style={{ color: '#fcd34d', maxWidth: 180 }}
                        title={rowNotice(f).message}
                      >
                        No preview for this format
                      </span>
                    )}
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
                          className="flex-1 px-1 py-0.5 text-[9px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
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
              )
            })}
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
                {/* §5d.2, same rule as the table: on a video card the still
                    frame is the play control. */}
                <button
                  type="button"
                  onClick={isVideoRow(f) ? () => setPreviewFile(f) : undefined}
                  disabled={!isVideoRow(f)}
                  title={isVideoRow(f) ? `Play ${displayName(f)}` : undefined}
                  className="block"
                  style={{ cursor: isVideoRow(f) ? 'pointer' : 'default' }}
                >
                  <FileThumbnail
                    file={f}
                    size="large"
                    projectId={projectId}
                    thumbnailUrl={thumbUrls.get(f.thumbnail_url) || null}
                  />
                </button>
              </div>
              <div className="p-2 flex flex-col gap-0.5">
                <span className="text-[10px] font-mono truncate" style={{ color: '#d6d3d1' }}>
                  {displayName(f)}
                </span>
                {/* §5f: the same inline note on the gallery card. */}
                {rowNotice(f) && (
                  <span
                    className="text-[9px] font-mono truncate"
                    style={{ color: '#fcd34d' }}
                    title={rowNotice(f).message}
                  >
                    No preview for this format
                  </span>
                )}
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

      {/* ── Session 40 (§5d.2): the player ──────────────────────────────────
          Mounted only while a file is selected, so no <video> element and no
          decoder pipeline exists until someone asks for one. `handleDownload`
          is the external-open path because it is the ONE place that knows how
          to turn a managed record into a real disk path. */}
      {previewFile && (
        <VideoPreview
          // 🚨 KEYED ON THE FILE. Without this, opening a clip that fails, then
          // opening a different one, reuses the same component instance — and
          // `remints` is a useRef, so the second clip arrives with its re-mint
          // budget already spent and gets no retry on an expired URL. A key is
          // the fix rather than resetting the ref, because handleError calls
          // load() and a reset inside load() would make the retry loop forever.
          key={previewFile.id}
          file={previewFile}
          projectId={projectId}
          managed={managed}
          onClose={() => setPreviewFile(null)}
          onOpenExternally={managed ? () => handleDownload(previewFile) : undefined}
        />
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
