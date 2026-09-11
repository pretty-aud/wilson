// =============================================================================
// Dialog — Bins' Modal promoted (plan §4, Q17).
//
// One backdrop (`backdrop`), one surface (`paper-raised`), 8px radius, the
// one shadow, header / body / footer. Widths are four tokens — 'confirm'
// 400 / 'form' 560 / 'reading' 720 / 'workbench' 960 — and nothing else may
// be written (review Part 3: two reviews proposed three-token scales that
// disagreed on every value). A number is accepted for Bins' existing
// callers until B6 re-points them.
//
// The behaviours: a modal stack with topmost-only Escape, a busy lock, the
// backdrop click, an `onBeforeClose` guard that may return false to keep the
// dialog open (the add dialog uses it to confirm before a reviewed batch is
// discarded), and `error` rendered INSIDE the footer (a failed confirm used
// to report into the page's notice bar, under the backdrop, so the button
// looked dead).
//
// 🚨 Q17. Bringing these to the ~60 overlays that lack them is behaviour, so
// C1 says ask. Until Audrey confirms, `DIALOG_BEHAVIOURS_DEFAULT` is false:
// a Dialog with no `behaviours` prop closes only from its X and its own
// buttons, exactly as those overlays do today. binUi's Modal passes
// `behaviours` explicitly, so Bins keep everything they have. When she says
// yes, flip the constant; every caller inherits it.
// =============================================================================

import { useEffect, useRef } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { pushModal, isTopModal } from './overlay'

export const DIALOG_WIDTHS = Object.freeze({ confirm: 400, form: 560, reading: 720, workbench: 960 })

/** Q17: false until Audrey confirms the standing permission (plan §2). */
export const DIALOG_BEHAVIOURS_DEFAULT = false

export function Dialog({
  title,
  children,
  footer,
  onClose,
  width = 'form',
  subtitle = null,
  busy = false,
  error = null,
  onBeforeClose = null,
  behaviours = DIALOG_BEHAVIOURS_DEFAULT,
  className = '',
  ...rest
}) {
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose
  const busyRef = useRef(busy); busyRef.current = busy
  const guardRef = useRef(onBeforeClose); guardRef.current = onBeforeClose
  const tryClose = () => {
    if (busyRef.current) return
    if (guardRef.current && guardRef.current() === false) return
    onCloseRef.current?.()
  }
  const tryCloseRef = useRef(tryClose); tryCloseRef.current = tryClose

  useEffect(() => {
    if (!behaviours) return undefined
    const id = {}
    const unregister = pushModal(id)
    const key = (e) => { if (e.key === 'Escape' && isTopModal(id)) tryCloseRef.current() }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); unregister() }
  }, [behaviours])

  const px = typeof width === 'number' ? width : (DIALOG_WIDTHS[width] ?? DIALOG_WIDTHS.form)
  if (import.meta.env?.DEV && typeof width === 'string' && !DIALOG_WIDTHS[width]) {
    console.error(`Dialog: unknown width "${width}" — use confirm | form | reading | workbench`)
  }

  return (
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(e) => { if (behaviours && e.target === e.currentTarget) tryClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        aria-busy={busy || undefined}
        className={`ui-dialog ${className}`.trim()}
        style={{ width: px }}
        data-width={typeof width === 'string' ? width : undefined}
        {...rest}
      >
        <div className="ui-dialog-head">
          <div>
            <div className="ui-dialog-title">{title}</div>
            {subtitle && <div className="ui-dialog-subtitle">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={tryClose}
            disabled={busy}
            title="Close"
            aria-label="Close"
            className="ui-iconbtn"
            data-size="sm"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="ui-dialog-body">{children}</div>
        {(footer || error) && (
          <div className="ui-dialog-foot">
            {error && (
              <span role="alert" className="ui-dialog-error">
                <AlertTriangle aria-hidden="true" />
                <span title={String(error)}>{String(error)}</span>
              </span>
            )}
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Dialog
