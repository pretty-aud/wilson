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
// The stack sits bottom centre, 24px up, newest at the bottom. A toast
// auto-dismisses after `duration` (default 5s; 0 = sticky); hovering it
// pauses the timer (RabbitProvider's UndoToast idiom, which was the best
// forgiveness pattern in the app). `Toast` itself is presentational so a
// test, or a surface with its own stack manager, can render one.
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

export function ToastProvider({ children }) {
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
      <div className="ui-toast-stack" aria-live="polite">
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
