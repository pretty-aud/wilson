// ============================================================
// RABBIT — Bins: shared UI primitives (demo 2026-09-11)
// ============================================================
//
// The Bins tab is built from these so every screen in it reads the same:
// the dark stone surface, orange for the one primary action, mono uppercase
// labels at 10–11px, 2px radii, 1px #44403c borders — the ScenesView idiom.
//
// UI overhaul, 2026-09-11: these thirteen primitives were promoted into
// src/ui/ (Button, IconButton, Chip, Kbd, Menu, Dialog, Field, Input,
// TextArea, Select, EmptyState, Spinner, Switch) and this file briefly
// re-exported them. Audrey ruled that Bins keeps today's look until its own
// session, B6 ("Bins waits for ITS OWN session"), so the local copies are
// back, byte-for-byte from 11ece44 except the one `focus:outline-none`
// the app-wide sweep removed (the global ring in src/index.css applies).
// B6 re-points every Bins file at src/ui and deletes this file's copies;
// until then the kit's versions are the contract and these are the
// legacy. binsDialogs.test.jsx renders every Bins dialog against this file.

import { useEffect, useRef } from 'react'
import { X, Check, Ban, Circle, AlertTriangle } from 'lucide-react'
import { MEDIA_TYPE_META, COLOR_HEX, COLORS } from '../../bins/binMedia'

export const C = {
  bg: '#1c1917', panel: '#292524', deep: '#0c0a09', line: '#44403c', faint: '#292524',
  text: '#d6d3d1', bright: '#fff7ed', muted: '#a8a29e', dim: '#78716c', dimmer: '#57534e',
  accent: '#ea580c', accentBorder: '#c2410c', accentText: '#fb923c',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
}

export function Btn({ children, onClick, primary = false, danger = false, disabled = false, title, small = false, className = '', style = {}, type = 'button', ...rest }) {
  const base = primary
    ? { color: C.bright, backgroundColor: C.accent, border: `1px solid ${C.accentBorder}` }
    : danger
      ? { color: '#fca5a5', backgroundColor: 'transparent', border: '1px solid #7f1d1d' }
      : { color: C.text, backgroundColor: 'transparent', border: `1px solid ${C.line}` }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 ${small ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[10.5px]'} font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${className}`}
      style={{ ...base, ...style }}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconBtn({ Icon, title, onClick, active = false, disabled = false, danger = false, size = 3.5, className = '', style = {} }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
      style={{
        color: danger ? '#fca5a5' : active ? C.bright : C.muted,
        backgroundColor: active ? C.accent : 'transparent',
        border: `1px solid ${active ? C.accentBorder : C.line}`,
        ...style,
      }}
    >
      <Icon className={`w-${size} h-${size}`} style={{ width: `${size * 4}px`, height: `${size * 4}px` }} />
    </button>
  )
}

export function MediaTag({ type, small = false, onClick, title }) {
  const meta = MEDIA_TYPE_META[type] || MEDIA_TYPE_META.other
  return (
    <span
      onClick={onClick}
      title={title || meta.label}
      className={`inline-flex items-center rounded-sm font-mono uppercase tracking-wider ${small ? 'px-1 text-[8.5px] leading-[14px]' : 'px-1.5 text-[9.5px] leading-[18px]'} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ color: meta.color, backgroundColor: meta.bg, border: `1px solid ${meta.color}33` }}
    >
      {small ? meta.short : meta.label}
    </span>
  )
}

export function ColorDot({ color, size = 10, onClick, title, hollow = false }) {
  const hex = color ? COLOR_HEX[color] : null
  return (
    <span
      onClick={onClick}
      title={title || (color ? color : 'no colour')}
      className={`inline-block rounded-full flex-shrink-0 ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        width: size, height: size,
        backgroundColor: hex && !hollow ? hex : 'transparent',
        border: hex ? `1.5px solid ${hex}` : `1px dashed ${C.dimmer}`,
      }}
    />
  )
}

export function ColorPicker({ value, onChange, size = 12 }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <ColorDot color={null} size={size} onClick={() => onChange(null)} title="No colour" />
      {COLORS.map(c => (
        <span key={c} onClick={() => onChange(c)} title={c}
          className="inline-flex items-center justify-center rounded-full cursor-pointer"
          style={{ width: size + 6, height: size + 6, border: value === c ? `1px solid ${C.bright}` : '1px solid transparent' }}>
          <ColorDot color={c} size={size} />
        </span>
      ))}
    </div>
  )
}

/** The review marks: ✓ select (green), ⊘ reject (red), ○ circled (orange). */
export function FlagMark({ flag, circled, size = 12, muted = false }) {
  const s = { width: size, height: size }
  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
      {flag === 'select' && <Check style={{ ...s, color: muted ? C.dim : C.green }} />}
      {flag === 'reject' && <Ban style={{ ...s, color: muted ? C.dim : C.red }} />}
      {circled && <Circle style={{ ...s, color: muted ? C.dim : C.accentText }} strokeWidth={2.5} />}
    </span>
  )
}

export function Chip({ active = false, onClick, children, title, color = null, count = null }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="inline-flex items-center gap-1 px-2 py-[3px] text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700 whitespace-nowrap"
      style={{
        color: active ? C.bright : C.muted,
        backgroundColor: active ? (color || C.accent) : 'transparent',
        border: `1px solid ${active ? (color || C.accentBorder) : C.line}`,
      }}>
      {children}
      {count != null && <span className="opacity-70">{count}</span>}
    </button>
  )
}

export function Kbd({ children }) {
  return (
    <kbd className="inline-block px-1 rounded-sm text-[9px] font-mono leading-[14px]"
      style={{ color: C.muted, border: `1px solid ${C.line}`, backgroundColor: C.deep }}>{children}</kbd>
  )
}

// Open modals, bottom to top, and the count of open context menus. Escape
// closes only the TOPMOST modal (adversarial review: the take picker over
// the takes dialog closed both); registered once per mount so a re-render of
// a lower modal cannot move it to the top. `overlayOpen` lets document-level
// key handlers (the Bins keys, the preview's Space) stand down while any
// overlay from this module is up (review round 2: Space in the add dialog's
// list played the video behind the backdrop).
const modalStack = []
let openMenus = 0
export function overlayOpen() { return modalStack.length > 0 || openMenus > 0 }

/** A context menu at (x, y). items: { label, Icon, onClick, danger, disabled, divider, hint, header }. */
export function Menu({ x, y, items, onClose, minWidth = 200 }) {
  const ref = useRef(null)
  useEffect(() => { openMenus++; return () => { openMenus-- } }, [])
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    const key = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  // Keep the menu on screen.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1400
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const left = Math.min(x, vw - minWidth - 12)
  const maxH = Math.max(160, vh - y - 12)
  return (
    <div ref={ref} className="fixed z-[80] rounded-sm shadow-2xl overflow-y-auto"
      style={{ left, top: Math.min(y, vh - 60), minWidth, maxHeight: maxH, backgroundColor: C.panel, border: `1px solid ${C.line}` }}
      onContextMenu={e => e.preventDefault()}>
      {items.filter(Boolean).map((it, i) => it.divider
        ? <div key={`d${i}`} style={{ borderTop: `1px solid ${C.line}` }} />
        : it.header
          ? <div key={`h${i}`} className="px-3 py-1.5 text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim, borderBottom: `1px solid ${C.line}` }}>{it.header}</div>
          : (
            <button key={i} type="button" disabled={it.disabled}
              onClick={() => { if (it.disabled) return; it.onClick?.(); if (!it.keepOpen) onClose?.() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11.5px] font-mono hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: it.danger ? '#fca5a5' : C.text }}>
              {it.Icon && <it.Icon className="w-3 h-3 flex-shrink-0" style={{ color: it.danger ? '#fca5a5' : C.accentText }} />}
              {it.ColorDot && <ColorDot color={it.ColorDot} size={9} />}
              <span className="flex-1 truncate">{it.label}</span>
              {it.hint && <span className="text-[9.5px] ml-3 flex-shrink-0" style={{ color: C.dimmer }}>{it.hint}</span>}
            </button>
          ))}
    </div>
  )
}

/**
 * A modal. `error` is shown in the footer row, INSIDE the dialog (review
 * round 2: a failed confirm used to report into the page's notice bar, under
 * the 72% backdrop, so the button looked dead). `onBeforeClose` may return
 * false to keep the dialog open — Escape, the backdrop and the X all ask it
 * (the add dialog uses it to confirm before a reviewed batch is discarded).
 */
export function Modal({ title, children, footer, onClose, width = 640, subtitle = null, busy = false, error = null, onBeforeClose = null }) {
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
    const id = {}
    modalStack.push(id)
    const key = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) tryCloseRef.current() }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); const i = modalStack.indexOf(id); if (i >= 0) modalStack.splice(i, 1) }
  }, [])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ backgroundColor: 'rgba(12,10,9,0.72)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) tryClose() }}>
      <div className="rounded-sm shadow-2xl flex flex-col" style={{ width, maxWidth: '94vw', maxHeight: '88vh', backgroundColor: C.bg, border: `1px solid ${C.line}` }}
        role="dialog" aria-label={title}>
        <div className="flex items-start justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div>
            <div className="text-[12px] font-mono uppercase tracking-wider" style={{ color: C.bright }}>{title}</div>
            {subtitle && <div className="text-[10.5px] font-mono mt-0.5" style={{ color: C.dim }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={tryClose} disabled={busy} title="Close" className="p-1 rounded-sm hover:bg-stone-700 disabled:opacity-30" style={{ color: C.muted }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {(footer || error) && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0 flex-wrap" style={{ borderTop: `1px solid ${C.line}` }}>
            {error && <span role="alert" className="text-[10.5px] font-mono mr-auto flex items-center gap-1.5 min-w-0" style={{ color: '#fca5a5' }}><AlertTriangle className="w-3 h-3 flex-shrink-0" /> <span className="truncate" title={String(error)}>{String(error)}</span></span>}
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function Field({ label, children, hint, inline = false, mixed = false }) {
  return (
    <label className={`flex ${inline ? 'items-center gap-3' : 'flex-col gap-1'} min-w-0`}>
      <span className="text-[9.5px] font-mono uppercase tracking-wider flex-shrink-0" style={{ color: mixed ? C.amber : C.dim, minWidth: inline ? 88 : undefined }}>
        {label}{mixed ? ' · mixed' : ''}
      </span>
      <span className="flex-1 min-w-0">{children}</span>
      {hint && <span className="text-[9.5px] font-mono" style={{ color: C.dimmer }}>{hint}</span>}
    </label>
  )
}

const inputStyle = { backgroundColor: C.panel, color: C.text, border: `1px solid ${C.line}` }
const inputClass = 'w-full px-2 py-1 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500 placeholder:text-stone-600'

// Escape in a field is "cancel this edit": the value goes back to what it was
// when the field took focus, nothing is committed, and the key stops there so
// a modal around the field stays open (review round 2: Escape in a take's note
// closed the takes dialog and dropped the note; in the add dialog it discarded
// a whole reviewed batch). Enter commits through blur, as before.
function useEscapeRevert(onChange) {
  const initialRef = useRef(null)
  const cancelledRef = useRef(false)
  const onFocus = (e) => { initialRef.current = e.target.value; cancelledRef.current = false }
  const cancel = (e) => {
    e.stopPropagation(); e.preventDefault()
    cancelledRef.current = true
    if (initialRef.current != null) onChange?.(initialRef.current)
    e.currentTarget.blur()
  }
  const committing = () => { if (cancelledRef.current) { cancelledRef.current = false; return false } return true }
  return { onFocus, cancel, committing }
}

export function TextInput({ value, onChange, onCommit, placeholder, disabled, type = 'text', className = '', autoFocus = false, onKeyDown, style = {}, ...rest }) {
  const esc = useEscapeRevert(onChange)
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} disabled={disabled}
      autoFocus={autoFocus}
      onFocus={esc.onFocus}
      onBlur={() => { if (esc.committing()) onCommit?.() }}
      onKeyDown={e => { if (e.key === 'Enter' && type !== 'textarea') { e.currentTarget.blur() } else if (e.key === 'Escape') { esc.cancel(e); return } onKeyDown?.(e) }}
      className={`${inputClass} ${className}`} style={{ ...inputStyle, ...style }} {...rest} />
  )
}

export function TextArea({ value, onChange, onCommit, placeholder, rows = 3, disabled }) {
  const esc = useEscapeRevert(onChange)
  return (
    <textarea value={value ?? ''} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} rows={rows} disabled={disabled}
      onFocus={esc.onFocus}
      onBlur={() => { if (esc.committing()) onCommit?.() }}
      onKeyDown={e => { if (e.key === 'Escape') esc.cancel(e) }}
      className={`${inputClass} resize-y`} style={inputStyle} />
  )
}

export function Select({ value, onChange, options, disabled, placeholder = null, className = '' }) {
  return (
    <select value={value ?? ''} onChange={e => onChange?.(e.target.value === '' ? null : e.target.value)} disabled={disabled}
      className={`${inputClass} ${className}`} style={inputStyle}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  )
}

export function EmptyState({ Icon, title, body, children, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-8'} h-full`}>
      {Icon && <Icon className="w-8 h-8 mb-3" style={{ color: C.dimmer }} />}
      <div className="text-[12px] font-mono uppercase tracking-wider" style={{ color: C.muted }}>{title}</div>
      {body && <div className="text-[11px] font-mono mt-1.5 max-w-md leading-relaxed" style={{ color: C.dim }}>{body}</div>}
      {children && <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">{children}</div>}
    </div>
  )
}

export function Spinner({ size = 12 }) {
  return <span className="inline-block rounded-full animate-spin" style={{ width: size, height: size, border: `2px solid ${C.line}`, borderTopColor: C.accentText }} />
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <span className="relative inline-block rounded-full transition-colors" style={{ width: 28, height: 16, backgroundColor: checked ? C.accent : C.line }}
        onClick={() => onChange(!checked)}>
        <span className="absolute top-[2px] rounded-full transition-all" style={{ width: 12, height: 12, left: checked ? 14 : 2, backgroundColor: C.bright }} />
      </span>
      {label && <span className="text-[10.5px] font-mono" style={{ color: C.text }}>{label}</span>}
    </label>
  )
}
