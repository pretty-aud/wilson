// ============================================================
// InvoiceAttachment — attach an invoice to a budget actuals cell
// ============================================================
//
// Session 24. Audrey: "can the attach invoice button not able to work in the
// web app? it needs to work."
//
// MEASURED: it could not. The old implementation, duplicated in CrewTeamTab
// and TalentTab, called `window.rabbitDesktop.pickFiles`, POSTed to
// `http://localhost:19854/.../invoice-folder` to get a folder on the local
// disk, then `copyFile`d into it. On the staging-backed beta there is no
// desktop bridge and no local server, so `if (!api?.pickFiles) return` fired
// on the first line and the button did nothing at all — silently, which is
// why it read as broken rather than unsupported.
//
// This component replaces both copies with one adapter-backed path that works
// on the web, in the desktop app, on Supabase and on Local Server:
//
//   pick   — a plain <input type="file">. Electron's renderer is Chromium, so
//            this works there too; the desktop bridge was never needed just
//            to choose a file.
//   store  — adapter.uploadFile(), which every adapter implements, taking the
//            same browser File object.
//   open   — adapter.downloadFile() -> Blob -> object URL.
//
// 🚨 INVOICES ARE FINANCIAL DOCUMENTS AND ARE GATED AS SUCH.
// `scope.financial` puts the blob under the reserved `invoices` path segment
// and sets `files.is_financial`. Migration 0038 gates BOTH independently on
// can_access_project_money(). Without it, the obvious implementation would
// have let any reviewer download the invoice PDF — hiding the amount while
// serving the document that states it is not a policy, it is a leak.
//
// Reference format, stored in budget_actuals.attachment_path:
//   `file:<uuid>`  a files row — the only thing written from now on
//   anything else  a legacy absolute Windows path from the desktop-only
//                  implementation. Still openable in the desktop app, and
//                  honestly labelled everywhere else rather than silently
//                  doing nothing, which is the bug this replaces.

import { useRef, useState } from 'react'
import { Paperclip, FolderOpen, X, Loader2, AlertCircle } from 'lucide-react'

export const FILE_REF_PREFIX = 'file:'

export function isCloudRef(path) {
  return typeof path === 'string' && path.startsWith(FILE_REF_PREFIX)
}

export default function InvoiceAttachment({
  getAdapter,
  projectId,
  lineId,
  name,
  path,
  onChange,
  disabled,
}) {
  const inputRef = useRef(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  const desktopOnlyLegacy = !!path && !isCloudRef(path)
  const canOpenLegacy = desktopOnlyLegacy && !!window.rabbitDesktop?.openInExplorer

  async function handlePicked(e) {
    const file = e.target.files?.[0]
    // Always clear, so re-picking the same file fires change again.
    e.target.value = ''
    if (!file) return

    const adapter = getAdapter?.()
    if (!adapter?.uploadFile) {
      setError('This backend cannot store files.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const row = await adapter.uploadFile(projectId, { financial: true, lineId }, file)
      if (!row?.id) throw new Error('upload returned no file record')
      onChange({ name: file.name, path: `${FILE_REF_PREFIX}${row.id}` })
    } catch (err) {
      // Loud on purpose. The failure this component exists to fix was a
      // silent one, and a silent replacement would be no better.
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleOpen() {
    if (canOpenLegacy) {
      window.rabbitDesktop.openInExplorer({ filePath: path })
      return
    }
    if (!isCloudRef(path)) return

    const adapter = getAdapter?.()
    if (!adapter?.downloadFile || !adapter?.listFiles) return

    setBusy(true)
    setError(null)
    try {
      const id = path.slice(FILE_REF_PREFIX.length)
      const files = await adapter.listFiles(projectId)
      const row = (files || []).find(f => f.id === id)
      // A missing row is the expected shape of "you are not cleared for this"
      // as well as "it was deleted" — RLS returns an empty set, not an error.
      // Say something either way rather than appearing to do nothing.
      if (!row) throw new Error('That invoice is no longer available to you.')
      const blob = await adapter.downloadFile(row)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // Give the new tab time to take the blob before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>
        Invoice File
      </label>

      <input ref={inputRef} type="file" onChange={handlePicked} className="hidden" />

      {name ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-sm"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
          <Paperclip className="w-3 h-3 flex-shrink-0" style={{ color: '#fb923c' }} />
          <span className="flex-1 text-[10.5px] font-mono truncate" style={{ color: '#d6d3d1' }}>{name}</span>
          {(isCloudRef(path) || canOpenLegacy) && (
            <button type="button" onClick={handleOpen} disabled={busy}
              className="p-0.5 hover:bg-stone-700 rounded transition-colors"
              title={isCloudRef(path) ? 'Open invoice' : 'Show in explorer'}>
              {busy
                ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#a8a29e' }} />
                : <FolderOpen className="w-3 h-3" style={{ color: '#a8a29e' }} />}
            </button>
          )}
          <button type="button" onClick={() => { setError(null); onChange({ name: '', path: '' }) }}
            className="p-0.5 hover:bg-stone-700 rounded transition-colors" title="Remove attachment">
            <X className="w-3 h-3" style={{ color: '#ef4444' }} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || disabled}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[10.5px] font-mono rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-40"
          style={{ border: '1px solid #44403c', color: '#a8a29e' }}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
          {busy ? 'Uploading…' : 'Attach Invoice'}
        </button>
      )}

      {/* A legacy row points at a path on one particular machine. Say so —
          the old code just made the button do nothing. */}
      {desktopOnlyLegacy && !canOpenLegacy && (
        <span className="text-[9px] font-mono leading-snug" style={{ color: '#78716c' }}>
          Saved by the desktop app to a folder on that computer. Re-attach it here
          to make it available everywhere.
        </span>
      )}

      {error && (
        <span className="flex items-start gap-1 text-[9px] font-mono leading-snug" style={{ color: '#ef4444' }}>
          <AlertCircle className="w-2.5 h-2.5 mt-px flex-shrink-0" />
          {error}
        </span>
      )}
    </div>
  )
}
