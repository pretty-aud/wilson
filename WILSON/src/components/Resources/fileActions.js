// =============================================================================
// Resources/fileActions.js — what the file window can DO with a row, decided
// in one place (post-overhaul S4a, Audrey's E9 and E11).
//
//   * Where its bytes are. A row whose bytes are on THIS computer is a
//     "desktop row": a Local Server project's file or managed file, or a
//     private project's body (0072: storage_provider 'local_server' on the
//     cloud adapter, under the local media root). For those, E9 says
//     Download REVEALS the file ("desktop rows already on disk reveal the
//     file") and "Open in default app" exists. Everything else is a cloud body.
//   * How a cloud body downloads: the signed attachment URL first (Session
//     42: no Blob ceiling, the browser's own download manager), the Blob only
//     where nothing can sign — FileManager.handleCloudDownload's path, with
//     the same reasons.
//
// The desktop never takes a PATH from here: `rabbit:open-path` is handed the
// row ({ source, projectId, fileId } or { source: 'media', mediaKey }) and
// main resolves the path with its own contained resolvers.
// =============================================================================

/** The open-path bridge, or null off the desktop (the web build has none). */
export function desktopBridge() {
  const api = typeof window !== 'undefined' ? window.electronAPI?.rabbit : null
  return api && typeof api.openPath === 'function' ? api : null
}

/**
 * Where a tree node's bytes are on this computer, as the IPC names them —
 * or null for a cloud body (or a node that is not a file).
 */
export function diskSourceFor(node, { adapterMode, projectId } = {}) {
  const row = node?.row
  if (!row || node.kind !== 'file') return null
  const source = node.meta?.source
  if (source === 'managed') return { source: 'managed', projectId, fileId: row.id }
  if (adapterMode === 'local_server') return { source: 'files', projectId, fileId: row.id }
  if (row.storage_provider === 'local_server' && row.storage_path) {
    return { source: 'media', mediaKey: row.storage_path }
  }
  return null
}

/** The row's own display name, as FileManager names a download. */
export function downloadName(node) {
  const row = node?.row || {}
  return node?.name || row.name || row.file_name || row.original_name || 'download'
}

/**
 * Download a cloud body: the signed attachment URL when the provider can mint
 * one, the Blob otherwise. Throws the provider's sentence on a refusal (an
 * RLS denial, a private project off the desktop) for the caller to SHOW.
 */
export async function downloadCloudFile({ downloadUrl, downloadFile }, row, name, doc = document) {
  const signed = downloadUrl ? await downloadUrl(row, name) : null
  if (signed) {
    // No `a.download` on a signed URL: it is cross-origin, the attribute is
    // ignored, and the filename rides on Content-Disposition (S42).
    clickLink(doc, signed)
    return { via: 'url' }
  }
  if (!downloadFile) throw new Error('This backend cannot download files.')
  const blob = await downloadFile(row)
  const url = URL.createObjectURL(blob)
  try {
    clickLink(doc, url, name)
  } finally {
    // Revoking at once can cancel the download in some browsers (S27).
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return { via: 'blob' }
}

function clickLink(doc, href, filename) {
  const a = doc.createElement('a')
  a.href = href
  a.rel = 'noopener'
  if (filename) a.download = filename
  doc.body.appendChild(a)
  a.click()
  a.remove()
}
