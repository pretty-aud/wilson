// =============================================================================
// Dialog — Bins' Modal promoted (plan §4, Q17).
//
// One backdrop (`backdrop`), one surface (`paper-raised`), 6px radius (Q5),
// the one shadow, header / body / footer. Widths are four tokens — 'confirm'
// 400 / 'form' 560 / 'reading' 720 / 'workbench' 960 — and nothing else may
// be written (review Part 3: two reviews proposed three-token scales that
// disagreed on every value). A number is accepted for Bins' existing
// callers until B6 re-points them.
//
// The behaviours (Q17, ruled 2026-09-11: "yes, but keep it minimal" —
// Escape-to-close, the modal stack and the busy lock, nothing else, no
// flag): a modal stack with topmost-only Escape, a busy lock, the backdrop
// click that binUi's Modal already had, an `onBeforeClose` guard that may
// return false to keep the dialog open (the add dialog uses it to confirm
// before a reviewed batch is discarded), and `error` rendered INSIDE the
// footer (a failed confirm used to report into the page's notice bar, under
// the backdrop, so the button looked dead). No chrome beyond header / body /
// footer; no motion beyond the 200ms fade in index.css.
//
// F3 adds FOCUS MANAGEMENT and nothing else with it (C2 KR-5): initial focus,
// a Tab trap on the topmost dialog, and focus returned to whatever had it
// when the dialog opened. It is not decoration and it is not a fourth
// behaviour beyond Q17's three — `role="dialog" aria-modal="true"` was
// already being announced here, and until F3 none of the three things that
// role promises was true. W9 converts twenty-seven `window.confirm` calls to
// this component across every lane; `window.confirm` is a real modal that
// takes focus, traps it and gives it back, so without this each conversion
// trades a working keyboard path for a broken one.
// =============================================================================

import { useEffect, useRef } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { pushModal, isTopModal, focusableWithin } from './overlay'

export const DIALOG_WIDTHS = Object.freeze({ confirm: 400, form: 560, reading: 720, workbench: 960 })

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
  // Q17 ruled Escape, the stack and the busy lock "and nothing else": a
  // click on the backdrop closes ONLY when the caller asks (Bins' Modal
  // does, because Bins had it), so the ~60 overlays that adopt Dialog later
  // do not lose a form to a stray click (review round 2).
  dismissOnBackdrop = false,
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

  const surfaceRef = useRef(null)

  // 🚨 CAPTURED IN RENDER, NOT IN THE EFFECT. React applies a child's
  // `autoFocus` during the COMMIT, which is before any effect runs — so an
  // effect that reads `document.activeElement` reads the dialog's own field
  // and "restores" focus to a node that is about to be removed. Measured in
  // the running app on the rate dialog, which has an autoFocus field: the
  // dialog closed and focus fell to <body>. Render runs before the commit,
  // so this is the only phase that still sees the control the user was on.
  const returnToRef = useRef(null)
  if (returnToRef.current === null && typeof document !== 'undefined') {
    returnToRef.current = document.activeElement
  }
  // What took focus on the FIRST mount, so a remount lands in the same place.
  // React 18 StrictMode runs every effect mount → unmount → mount in dev, and
  // `autoFocus` does not fire again on that second mount (the DOM node is not
  // recreated), so without this a dev build focuses the Close button where a
  // production build focuses the field. A kit whose keyboard behaviour differs
  // between the two is worse than one with none.
  const landedRef = useRef(null)

  // Registered ONCE per mount so a re-render of a lower dialog cannot move
  // it to the top of the stack; only the topmost dialog answers Escape — and,
  // since F3, only the topmost dialog holds the Tab key.
  useEffect(() => {
    const id = {}
    const unregister = pushModal(id)
    const node = surfaceRef.current
    const returnTo = returnToRef.current

    // ── Initial focus ──
    // A child that asked for focus itself keeps it: React applies `autoFocus`
    // during the commit, which is before this effect runs, so the test is
    // "is focus already inside?" and not "did a caller pass a prop?". Every
    // existing `autoFocus` call site and the two stopgaps that autofocus
    // Cancel (C2) keep working unchanged. Otherwise the element that took it
    // last time, then the first focusable one, then the surface itself when
    // the dialog holds none.
    if (node) {
      if (node.contains(document.activeElement)) {
        landedRef.current = document.activeElement
      } else {
        // No "is it still focusable?" check on the remembered element. The
        // effect has `[]` deps, so it runs exactly twice and only under
        // StrictMode, both runs inside the same commit — nothing can have
        // disabled or hidden it in between. A predicate that cannot differ
        // is the inert guard this file already lost one of.
        const remembered = landedRef.current
        const target = (remembered && node.contains(remembered))
          ? remembered
          : (focusableWithin(node)[0] || node)
        target.focus()
        landedRef.current = target
      }
    }

    const key = (e) => {
      if (!isTopModal(id)) return
      if (e.key === 'Escape') { tryCloseRef.current(); return }
      if (e.key !== 'Tab' || !node) return

      // ── The trap ──
      // `aria-modal` tells assistive technology the rest of the page is inert;
      // it does nothing to the Tab key, and the page behind is still in the
      // tab order. On the Dashboard the task confirm opens over a
      // TaskDetailPopup that stays mounted BY DESIGN, so Tab walked its
      // fifteen controls behind the backdrop (C2 KR-5). W9 sends the kit's
      // Dialog to twenty-seven `window.confirm` sites, and `window.confirm`
      // was a real modal — without this, every one of those conversions is a
      // keyboard regression.
      const items = focusableWithin(node)
      if (items.length === 0) { e.preventDefault(); node.focus(); return }
      // 🚨 POSITION IN THE LIST, not identity against its two ends. The first
      // cut compared `active` to `first` and `last` and treated everything
      // else as "inside, leave it alone" — which silently included the
      // SURFACE. `tabIndex={-1}` makes the surface click-focusable, and the
      // zero-focusable branch above parks focus on it deliberately, so
      // `active === node` is a normal state; it is neither end, and
      // `node.contains(node)` is TRUE so it did not read as outside either.
      // Both branches missed, nothing was prevented, and Shift+Tab walked
      // out to the page behind the backdrop — measured, onto a live control.
      // `indexOf` folds all of it into one test: -1 is the surface, <body>,
      // anything behind the backdrop, and anything inside the dialog that the
      // focusable list and the browser's tab order disagree about.
      const i = items.indexOf(document.activeElement)
      if (e.shiftKey ? i <= 0 : (i === -1 || i === items.length - 1)) {
        e.preventDefault()
        ;(e.shiftKey ? items[items.length - 1] : items[0]).focus()
      }
    }
    document.addEventListener('keydown', key)

    return () => {
      document.removeEventListener('keydown', key)
      unregister()
      // ── Focus restore ──
      // Only if the element that had it is still in the document: the row a
      // delete dialog was opened from is routinely gone by the time the
      // dialog closes, and `focus()` on a detached node silently drops focus
      // to <body>. `document.body` is not worth restoring to.
      // No "is it inside this dialog?" guard here, deliberately: `returnTo`
      // is captured during the first render, when this dialog's own DOM does
      // not exist yet, so it can never be a node inside it. A guard that
      // cannot fire is the inert-fix shape the reviews in this repo keep
      // finding; the break-it pass proved this one was exactly that.
      if (returnTo && returnTo !== document.body && returnTo.isConnected) {
        returnTo.focus?.()
      }
    }
  }, [])

  const px = typeof width === 'number' ? width : (DIALOG_WIDTHS[width] ?? DIALOG_WIDTHS.form)
  if (import.meta.env?.DEV && typeof width === 'string' && !DIALOG_WIDTHS[width]) {
    console.error(`Dialog: unknown width "${width}" — use confirm | form | reading | workbench`)
  }

  return (
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(e) => { if (dismissOnBackdrop && e.target === e.currentTarget) tryClose() }}
    >
      <div
        {...rest}
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        /* The fallback focus target when the dialog holds nothing focusable
           (a message with no footer). Not a tab stop. */
        tabIndex={-1}
        aria-label={typeof title === 'string' ? title : undefined}
        aria-busy={busy || undefined}
        className={`ui-dialog ${className}`.trim()}
        style={{ ...rest.style, width: px }}
        data-width={typeof width === 'string' ? width : rest['data-width']}
        data-surface="dark"
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
