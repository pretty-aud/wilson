// ============================================================
// GoogleSheetUrlPrompt — small modal to paste a sheet URL
// ============================================================
//
// Used by RateCardPage when the user clicks the "Google Sheet"
// importer card. Validates the URL via parseGoogleSheetUrl and
// surfaces the inline error before kicking off the actual fetch.

import { useEffect, useState } from 'react'
import { X, Link as LinkIcon, AlertCircle } from 'lucide-react'
import { parseGoogleSheetUrl } from './googleSheetImporter'

export default function GoogleSheetUrlPrompt({ open, busy, onClose, onSubmit }) {
  const [url, setUrl] = useState('')
  const [validationError, setValidationError] = useState(null)

  useEffect(() => {
    if (!open) {
      setUrl('')
      setValidationError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  function handleSubmit(e) {
    e?.preventDefault?.()
    if (busy) return
    const trimmed = url.trim()
    if (!trimmed) {
      setValidationError('Please paste a Google Sheets URL.')
      return
    }
    const parsed = parseGoogleSheetUrl(trimmed)
    if (!parsed) {
      setValidationError('That does not look like a Google Sheets URL.')
      return
    }
    setValidationError(null)
    onSubmit(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.6)' }}
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col rounded-sm shadow-2xl"
        style={{
          width: 'min(540px, 92vw)',
          backgroundColor: '#fef3e8',
          border: '2px solid #7c2d12',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '2px solid #7c2d12', backgroundColor: '#f4a261' }}
        >
          <div className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4" style={{ color: '#1c1917' }} />
            <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
              Import Google Sheet
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded-sm hover:bg-orange-200 disabled:opacity-30 transition-colors"
            style={{ color: '#1c1917' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-[11px] font-mono leading-relaxed" style={{ color: '#7c2d12' }}>
            Paste a public Google Sheets URL. The sheet must be shared as
            <strong> "Anyone with the link can view"</strong>. The first sheet
            (or the explicit gid) is used.
          </p>

          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setValidationError(null) }}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            disabled={busy}
            autoFocus
            className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:ring-2 focus:ring-orange-700"
            style={{
              backgroundColor: '#fff',
              color: '#1c1917',
              border: '2px solid #f4a261',
            }}
          />

          {validationError && (
            <div
              className="flex items-start gap-2 p-2 rounded-sm text-[11px] font-mono"
              style={{ backgroundColor: '#fee2e2', border: '1px solid #991b1b', color: '#991b1b' }}
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {validationError}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid #f4a261', backgroundColor: '#fff7ed' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
            style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
            style={{
              color: '#fff7ed',
              backgroundColor: '#ea580c',
              border: '1px solid #7c2d12',
            }}
          >
            {busy ? 'Fetching…' : 'Fetch sheet'}
          </button>
        </div>
      </form>
    </div>
  )
}
