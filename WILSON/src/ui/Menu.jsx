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
// the mono at the Label step. Floating surface: paper-raised, 6px radius
// (Q5), the one shadow. Items are 28px, Dense.
// =============================================================================

import { useEffect, useLayoutEffect, useRef } from 'react'
import { menuOpened } from './overlay'

export function Menu({ x, y, items, onClose, minWidth = 200, className = '', ...rest }) {
  const ref = useRef(null)
  useEffect(() => menuOpened(), [])
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    // K4: the Escape is marked handled, so a Dialog this menu sits in does not
    // close on the same key (see Dialog's key handler).
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.() } }
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
  // It may be as tall as the window allows; it scrolls only past that.
  const maxHeight = Math.max(160, vh - 24)

  // 🚨 PLACED FROM ITS RENDERED HEIGHT, before paint (A2 review rounds 1 and
  // 2). It opens at the pointer's y; only if it would then run past the
  // bottom edge does it start higher, by exactly its own height. The first
  // fix placed it as if every menu were 160px: a short menu that fitted
  // (Bins' "Move to" with two bins) jumped 40px up, and a 174px menu near
  // the bottom scrolled with 700px free above it. The one before that kept
  // the pointer's y and ran off the window, its last items unreachable.
  // Written to the node, not to state: this runs after every commit, and
  // React leaves `top` alone while `y` is unchanged.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    el.style.top = `${y + h > vh - 12 ? Math.max(12, vh - h - 12) : y}px`
  })

  // No `role="menu"` / `menuitem` yet: those roles promise arrow-key roving
  // focus and a suppressed Tab, which this menu does not implement (the Bins
  // menu it replaces was a plain column of buttons, and stays one — C1,
  // review round 1). F2 adds the keyboard model and the roles together.
  return (
    <div
      ref={ref}
      className={`ui-menu ${className}`.trim()}
      data-surface="dark"
      style={{ left, top: y, minWidth, maxHeight }}
      onContextMenu={(e) => e.preventDefault()}
      {...rest}
    >
      {items.filter(Boolean).map((it, i) => {
        if (it.divider) return <div key={`d${i}`} className="ui-menu-divider" />
        if (it.header) return <div key={`h${i}`} className="ui-menu-header">{it.header}</div>
        return (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            className="ui-menu-item"
            data-danger={it.danger ? 'true' : undefined}
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
