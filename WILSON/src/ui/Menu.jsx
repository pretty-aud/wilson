// =============================================================================
// Menu — a context menu at (x, y), promoted from Bins' Menu (plan §4):
// header / divider / item / danger item / hint, viewport clamping, Escape
// and outside-click to close, and it registers with overlay.js so
// document-level key handlers stand down while it is open.
//
// items: { label, Icon, onClick, danger, disabled, divider, hint, header,
//          keepOpen, leading }
//
// `leading` is any node rendered before the label (Bins passes a colour dot
// through its own adapter in binUi.jsx). `hint` is a key or a short note in
// the mono at the Label step. Floating surface: paper-raised, 8px radius,
// the one shadow. Items are 28px, Dense.
// =============================================================================

import { useEffect, useRef } from 'react'
import { menuOpened } from './overlay'

export function Menu({ x, y, items, onClose, minWidth = 200, className = '', ...rest }) {
  const ref = useRef(null)
  useEffect(() => menuOpened(), [])
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    const key = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  // Keep the menu on screen.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1400
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const left = Math.max(0, Math.min(x, vw - minWidth - 12))
  const maxHeight = Math.max(160, vh - y - 12)

  return (
    <div
      ref={ref}
      role="menu"
      className={`ui-menu ${className}`.trim()}
      style={{ left, top: Math.min(y, vh - 60), minWidth, maxHeight }}
      onContextMenu={(e) => e.preventDefault()}
      {...rest}
    >
      {items.filter(Boolean).map((it, i) => {
        if (it.divider) return <div key={`d${i}`} className="ui-menu-divider" role="separator" />
        if (it.header) return <div key={`h${i}`} className="ui-menu-header">{it.header}</div>
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className="ui-menu-item"
            data-danger={it.danger || undefined}
            onClick={() => { if (it.disabled) return; it.onClick?.(); if (!it.keepOpen) onClose?.() }}
          >
            {it.Icon && <it.Icon aria-hidden="true" />}
            {it.leading}
            <span className="ui-menu-item-label">{it.label}</span>
            {it.hint && <span className="ui-menu-hint">{it.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default Menu
