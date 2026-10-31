// ============================================================
// GoogleSheetUrlPrompt — small modal to paste a sheet URL
// ============================================================
//
// Used by RateCardPage when the user clicks the "Google Sheet"
// importer card. Validates the URL via parseGoogleSheetUrl and
// surfaces the inline error before kicking off the actual fetch.
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// The second of the two overlays in this folder the reviews never reached. It
// was a hand-rolled modal with its own backdrop and its own Escape listener,
// a `#fef3e8` sheet with a 2px `#7c2d12` frame, an `#f4a261` header band, a
// `#fff7ed` footer, a `#fee2e2` error panel, a 2px-bordered field with a
// literal `#fff` fill — a WHITE input, which is the one thing Audrey has
// asked for by name twice (C9) — and 11px mono copy.
//
// It is `Dialog` + `Field` + `Input` + `Banner` now: same one field, same
// validation, same two outcomes, same words. `confirm` (400) is the width for
// a single field and two buttons.
// ============================================================

import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Banner, Button, Dialog, Field, Input } from '../../../ui'
import { parseGoogleSheetUrl } from './googleSheetImporter'
import '../../Resources/resources.css'

export default function GoogleSheetUrlPrompt({ open, busy, onClose, onSubmit }) {
  const [url, setUrl] = useState('')
  const [validationError, setValidationError] = useState(null)

  useEffect(() => {
    if (!open) {
      setUrl('')
      setValidationError(null)
    }
  }, [open])

  if (!open) return null

  function handleSubmit() {
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
    <Dialog
      width="form"
      title="Import a Google Sheet"
      busy={busy}
      onClose={onClose}
      // Both of these overlays closed on a backdrop click before. `Dialog`
      // makes that opt-in (Q17: the ~60 overlays adopting it must not
      // silently GAIN the click and lose a half-filled form), which means an
      // overlay that already had it must ask for it back, or the restyle has
      // changed what a click does — C1.
      dismissOnBackdrop
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={busy}>
            {busy ? 'Fetching…' : 'Fetch sheet'}
          </Button>
        </>
      )}
    >
      <p className="rc-url-note">
        Paste a public Google Sheets URL. The sheet must be shared as
        <strong> “Anyone with the link can view”</strong>. The first sheet, or
        the explicit gid, is used.
      </p>

      <Field label="Sheet URL">
        <Input
          type="url"
          value={url}
          onChange={(v) => { setUrl(v); setValidationError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          disabled={busy}
          autoFocus
        />
      </Field>

      {validationError && (
        <Banner tone="danger" Icon={AlertCircle}>{validationError}</Banner>
      )}
    </Dialog>
  )
}
