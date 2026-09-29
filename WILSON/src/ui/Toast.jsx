// =============================================================================
// Toast — one anchor, one stack, four tones (plan §4). Replaces five systems
// in five screen positions (R.A.B.B.I.T., D.O.G., O.T.T.E.R., Ingestion, the
// agent panel), none of which stacked and two of which could overlap.
//
//   <ToastProvider>…</ToastProvider>        once, near the app root
//   const toast = useToast()
//   toast.push({ tone: 'success', title: 'Saved', body: '12 files', duration: 4000, action })
//   toast.dismiss(id)
//
// The stack sits bottom centre, 24px above the page's BOTTOM BAR, newest at
// the bottom. A toast auto-dismisses after `duration` (default 5s; 0 =
// sticky); hovering it pauses the timer (RabbitProvider's UndoToast idiom,
// which was the best forgiveness pattern in the app). `Toast` itself is
// presentational so a test, or a surface with its own stack manager, can
// render one.
//
// ── `bar`, and why the anchor is not a flat 24px ────────────────────────────
// It was `bottom: 24px` off the WINDOW, which is 24px off the bar only on a
// page with no bar. D1b measured the cost (its §7, 2026-09-11): one toast is
// 40.84px and tops out at 64.84px, inside the 80px bottom bar of the light
// pages; two are 89.69px and straddle its edge. The bars are viewport-relative
// since Phase 4, so no constant can stand in for them.
//
// `bar` is the current page's bottom-bar height — a CSS length, and it comes
// from `PAGE_BARS`, which is the same source of truth the pet's `bottomOffset`
// reads (App.jsx: `calc(PAGE_BARS[currentPage].bottom + 16px)`). It is passed
// in rather than looked up here so the kit keeps no dependency on the layout
// registry, and because the shell has already resolved the page.
//
// 🚨 OMITTING it puts the stack back over the bar SILENTLY, so dev says so —
// on ABSENCE, never on a value. `'0px'` is a legitimate thing to pass: it is
// the old flat anchor and it is correct on a surface that has no bar. An
// earlier cut warned on `bar === '0px'` and so could not tell "not passed"
// from "passed, correctly"; every other dev error in this kit fires on a
// missing prop or on a value outside an enum, and this one now matches.
//
// Tone is a data attribute resolved in index.css; the ink is always `ink`,
// and the tone is a 3px left edge plus the icon, never a fill under text.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react'

export const TOAST_TONES = Object.freeze(['info', 'success', 'warning', 'danger'])
const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

const ToastContext = createContext(null)
let nextId = 1

export function Toast({ tone = 'info', title, body, action, onDismiss, className = '', ...rest }) {
  const Glyph = ICONS[tone] || Info
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`ui-toast ${className}`.trim()}
      data-tone={tone}
      data-surface="dark"
      {...rest}
    >
      <Glyph aria-hidden="true" style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--tone-color, var(--color-ink-2))', flexShrink: 0 }} />
      <div className="ui-toast-text">
        {title && <div className="ui-toast-title">{title}</div>}
        {body && <div className="ui-toast-body">{body}</div>}
      </div>
      {action}
      {onDismiss && (
        <button type="button" onClick={onDismiss} title="Dismiss" aria-label="Dismiss" className="ui-iconbtn" data-size="sm">
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function TimedToast({ item, onDismiss }) {
  const remaining = useRef(item.duration)
  const startedAt = useRef(0)
  const timer = useRef(null)
  // `onDismiss` is a fresh arrow on every stack render; held in a ref so the
  // effect below runs once and a second toast cannot restart the first's
  // timer (review round 1).
  const onDismissRef = useRef(onDismiss); onDismissRef.current = onDismiss
  const start = useCallback(() => {
    if (!item.duration) return
    startedAt.current = Date.now()
    timer.current = setTimeout(() => onDismissRef.current(), remaining.current)
  }, [item.duration])
  const pause = useCallback(() => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
  }, [])
  useEffect(() => { start(); return () => { if (timer.current) clearTimeout(timer.current) } }, [start])
  return (
    <Toast
      tone={item.tone}
      title={item.title}
      body={item.body}
      action={item.action}
      onDismiss={onDismiss}
      onMouseEnter={pause}
      onMouseLeave={start}
      data-toast-id={item.id}
    />
  )
}

export function ToastProvider({ children, bar }) {
  if (import.meta.env?.DEV && bar == null) {
    console.error('ToastProvider: `bar` is required — it is the current page’s bottom-bar height, from PAGE_BARS. Without it the stack sits 24px off the WINDOW and the bar covers it.')
  }
  const [items, setItems] = useState([])
  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), [])
  const push = useCallback(({ tone = 'info', title, body, duration = 5000, action } = {}) => {
    const id = nextId++
    setItems((list) => [...list, { id, tone, title, body, duration, action }])
    return id
  }, [])
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-stack" aria-live="polite" style={{ '--toast-bar': bar ?? '0px' }}>
        {items.map((item) => <TimedToast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />)}
      </div>
    </ToastContext.Provider>
  )
}

/** { push, dismiss }. Throws outside a ToastProvider so a missing provider is a stack trace, not a silent no-op. */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast() needs a <ToastProvider> above it')
  return ctx
}

export default Toast
