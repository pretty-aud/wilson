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

//
// UI overhaul B5 (2026-09-26): on the kit and lane B5's sheet (`rb-inv-`),
// since the Crew and Talent period popovers are its only hosts — the Label
// step over the field (its label was #78716c, 3.37:1 on the popover, the
// Budget's last contrast failure), the kit Button and IconButtons, and
// "Invoice file" / "Attach invoice" in sentence case (Q2).

import { useRef, useState } from 'react'
import { Paperclip, FolderOpen, X, AlertCircle } from 'lucide-react'
import { Button, IconButton } from '../../ui'
import '../../tools/rabbit_v0.1.0/views/rabbitBudget.css'

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
    <div className="rb-inv-field">
      <span className="rb-inv-label">Invoice file</span>

      <input ref={inputRef} type="file" onChange={handlePicked} className="hidden" aria-label="Invoice file" />

      {name ? (
        <div className="rb-inv-file">
          <Paperclip className="rb-inv-glyph" aria-hidden="true" />
          <span className="rb-inv-name" title={name}>{name}</span>
          {(isCloudRef(path) || canOpenLegacy) && (
            <IconButton
              Icon={FolderOpen}
              size="sm"
              onClick={handleOpen}
              disabled={busy}
              aria-busy={busy || undefined}
              title={isCloudRef(path) ? 'Open invoice' : 'Show in explorer'}
            />
          )}
          <IconButton
            Icon={X}
            size="sm"
            danger
            title="Remove attachment"
            onClick={() => { setError(null); onChange({ name: '', path: '' }) }}
          />
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          Icon={Paperclip}
          loading={busy}
          loadingLabel="Uploading…"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Attach invoice
        </Button>
      )}

      {/* A legacy row points at a path on one particular machine. Say so —
          the old code just made the button do nothing. */}
      {desktopOnlyLegacy && !canOpenLegacy && (
        <span className="rb-inv-note">
          Saved by the desktop app to a folder on that computer. Re-attach it here
          to make it available everywhere.
        </span>
      )}

      {error && (
        <span className="rb-inv-error">
          <AlertCircle className="rb-inv-error-glyph" aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  )
}
