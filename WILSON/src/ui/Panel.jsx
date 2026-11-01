// =============================================================================
// Panel — the one docked sidebar (plan §4).
//
//   Width tokens sm 200 / md 240 / lg 300, ONE hairline on the docked edge, a
//   32px header at the Label step, NO fill.
//
// Five widths (200, 200, 220, 224, 300), two border weights and four surface
// tones — including a one-off `#1f1c1a` that exists nowhere else in the app —
// become three widths and one rule. No fill is the point: a panel is defined
// by its hairline and its content, and the stone-800 / stone-700 pairing was
// three tones deep before anything had been drawn in it.
//
// SB1 (2026-11-01) — A LEFT-DOCKED PANEL RESIZES BY ITS EDGE. Audrey, of
// O.T.T.E.R.'s courses sidebar: "this divider line from the courses sidebar
// and the overall otter window should be expanding by grabbing and putting the
// line to the desired width of the courses sidebar. lets do the same with the
// sidebar in the dog tool". Both sidebars are Panels and the edge is the
// panel's own, so the one handle lives here (VS Code's sash, the WAI-ARIA
// window splitter), and `resizable` absent, a Panel is exactly what it was.
//
//   - The handle is an 8px strip over the 1px hairline (24px for a coarse
//     pointer), absolutely placed: it takes no layout width, so D.O.G.'s
//     preview keeps its pinned width (C4) at the default. At rest it draws
//     nothing; hover (after 200ms), a drag and keyboard focus draw one 2px
//     band of the signal over the line (src/index.css, PANEL).
//   - The width follows the pointer as `--ui-panel-size`, written straight on
//     the aside, so no tool re-renders while it moves; the drag's end is one
//     state update here and one storage write. React never writes that
//     property: a re-render mid-drag would put the old width back.
//   - Limits: `minWidth` / `maxWidth`, and `minBeside`, the room the row keeps
//     beside the panel, so a small window keeps the column beside it usable.
//     The maximum never goes under the token, so an untouched panel is the
//     token's width at every window size, as before. A remembered width that
//     no longer fits is trimmed on screen, kept in storage, and returns when
//     the window grows.
//   - Remembered per device in localStorage under `storageKey` (the collapse
//     flag's way, SidebarCollapse.jsx), only while it differs from the token:
//     a double-click, or any change landing on the token, removes the key.
//   - Keys: the arrows ±8, with Shift ±40, Home and End the limits. Escape
//     abandons a drag. Named by the panel's own label (its title, else its
//     `aria-labelledby`), as the APG's splitter is.
// =============================================================================

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { PANEL } from './tokens'

const WIDTHS = ['sm', 'md', 'lg']
const STEP = 8
const BIG_STEP = 40
/** Travel under this is a click: nothing moves, nothing is written. */
const SLOP = 3

// Where a width goes when localStorage throws (a private window, a sandboxed
// frame): kept for the page's life, so a collapsed sidebar reopened still
// returns to the width it had.
const unsaved = new Map()

function readWidth(key) {
  let v = null
  try { v = window.localStorage.getItem(key) } catch { /* unreadable: the memory below */ }
  if (v == null) v = unsaved.get(key) ?? null
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

function writeWidth(key, px) {
  try { window.localStorage.setItem(key, String(px)); unsaved.delete(key) } catch { unsaved.set(key, String(px)) }
}

function forgetWidth(key) {
  unsaved.delete(key)
  try { window.localStorage.removeItem(key) } catch { /* nothing was kept there */ }
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)

/** The widest the panel may be in a row this wide: never past `max`, never so
 *  wide the row keeps less than `beside`, never under the token. A row with no
 *  width (a hidden page; no layout under the test runner) trims nothing. */
function widestIn(row, { def, max, beside }) {
  return row > 0 ? Math.max(def, Math.min(max, row - beside)) : max
}

function usePanelSize({ on, storageKey, def, min, max, beside, asideRef }) {
  // The width chosen, as kept: out of range or too wide for the row, it is
  // clamped where it is shown (`shown`), never rewritten here.
  const [width, setWidth] = useState(() => (on && storageKey ? readWidth(storageKey) : null) ?? def)
  const [row, setRow] = useState(0)
  const drag = useRef(null)

  // The row's width, now and whenever the window changes it.
  useLayoutEffect(() => {
    const rowEl = on ? asideRef.current?.parentElement : null
    if (!rowEl) return undefined
    const measure = () => setRow(rowEl.clientWidth)
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(rowEl)
    return () => ro.disconnect()
  }, [on, asideRef])

  const widest = widestIn(row, { def, max, beside })
  const shown = clamp(width, min, widest)
  // What an abandoned drag puts back: the width as last drawn by React, which
  // a window resized mid-drag may have moved since the press.
  const drawn = useRef(shown)

  useLayoutEffect(() => {
    drawn.current = shown
    if (on) asideRef.current?.style.setProperty('--ui-panel-size', `${shown}px`)
  }, [on, shown, asideRef])

  // A drag the panel did not see end (Ctrl/Cmd+\ collapses O.T.T.E.R.'s
  // mid-drag): the page is handed back its cursor and its selection.
  useEffect(() => () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    window.removeEventListener('keydown', d.onKey, true)
    document.documentElement.removeAttribute('data-ui-resizing')
  }, [])

  // `next` arrives clamped and whole (the drag and the keys clamp it).
  const commit = (next) => {
    setWidth(next)
    if (!storageKey) return
    if (next === def) forgetWidth(storageKey)
    else writeWidth(storageKey, next)
  }

  const paint = (handle, px) => {
    asideRef.current?.style.setProperty('--ui-panel-size', `${px}px`)
    handle.setAttribute('aria-valuenow', String(px))
    handle.setAttribute('aria-valuetext', `${px} pixels`)
  }

  const end = (keep) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    window.removeEventListener('keydown', d.onKey, true)
    document.documentElement.removeAttribute('data-ui-resizing')
    d.handle.removeAttribute('data-dragging')
    try { if (d.handle.hasPointerCapture?.(d.id)) d.handle.releasePointerCapture(d.id) } catch { /* already released */ }
    if (!d.moved) return
    if (keep) commit(d.now)
    else paint(d.handle, drawn.current)
  }

  const handlers = {
    // Focus stays where it was, and no selection or native drag (so no file
    // drop) can start from the press (NumberField's steppers do the same).
    onMouseDown: (e) => e.preventDefault(),
    onPointerDown: (e) => {
      if (e.button !== 0 || e.isPrimary === false || drag.current) return
      const handle = e.currentTarget
      const rowEl = asideRef.current?.parentElement
      const d = {
        id: e.pointerId,
        x: e.clientX,
        from: shown,
        now: shown,
        max: widestIn(rowEl ? rowEl.clientWidth : 0, { def, max, beside }),
        moved: false,
        handle,
        onKey: null,
      }
      // Escape abandons the drag, and only the drag: a field holding focus
      // must not take it as its own (Input reverts an edit on Escape).
      d.onKey = (ev) => {
        if (ev.key !== 'Escape') return
        ev.preventDefault()
        ev.stopPropagation()
        end(false)
      }
      drag.current = d
      try { handle.setPointerCapture?.(e.pointerId) } catch { /* the pointer is gone */ }
      window.addEventListener('keydown', d.onKey, true)
      handle.setAttribute('data-dragging', 'true')
      document.documentElement.setAttribute('data-ui-resizing', '')
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      const dx = e.clientX - d.x
      if (!d.moved && Math.abs(dx) < SLOP) return
      d.moved = true
      const next = clamp(Math.round(d.from + dx), min, d.max)
      if (next === d.now) return
      d.now = next
      paint(d.handle, next)
    },
    onPointerUp: (e) => { if (drag.current?.id === e.pointerId) end(true) },
    onPointerCancel: (e) => { if (drag.current?.id === e.pointerId) end(false) },
    // Capture taken away without a release: keep what is on screen.
    onLostPointerCapture: (e) => { if (drag.current?.id === e.pointerId) end(true) },
    onDoubleClick: () => {
      setWidth(def)
      if (storageKey) forgetWidth(storageKey)
    },
    onKeyDown: (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const step = e.shiftKey ? BIG_STEP : STEP
      const next = e.key === 'ArrowRight' ? shown + step
        : e.key === 'ArrowLeft' ? shown - step
          : e.key === 'Home' ? min
            : e.key === 'End' ? widest
              : null
      if (next == null) return
      e.preventDefault()
      commit(clamp(next, min, widest))
    },
  }

  return { shown, widest, handlers }
}

export function Panel({
  children,
  title,
  actions,
  width = 'md',
  side = 'left',
  surface = 'dark',
  className = '',
  resizable = false,
  storageKey,
  minWidth,
  maxWidth,
  minBeside = 0,
  ...rest
}) {
  // An unknown width used to render data-width="220px", which matches no
  // rule, so the element got NO width at all and nothing said so in a
  // production build — the silent-wrong-answer shape the page registry
  // next door exists to eliminate. It falls back to the scale.
  const w = WIDTHS.includes(width) ? width : 'md'
  if (import.meta.env?.DEV && w !== width) console.error(`Panel: unknown width "${width}" — using "md"`)
  const on = resizable && side === 'left'
  const def = PANEL[w]
  const min = minWidth ?? def
  const max = maxWidth ?? def
  if (import.meta.env?.DEV && resizable && !on) console.error(`Panel: resizable is left-docked only — side="${side}" draws no handle`)
  if (import.meta.env?.DEV && on && !(min <= def && def <= max)) console.error(`Panel: the ${w} width (${def}px) is outside minWidth ${min} / maxWidth ${max}`)
  const asideRef = useRef(null)
  const ownId = useId()
  const titleId = useId()
  const { shown, widest, handlers } = usePanelSize({ on, storageKey, def, min, max, beside: minBeside, asideRef })
  const id = rest.id ?? ownId
  return (
    <aside
      ref={asideRef}
      className={`ui-panel ${className}`.trim()}
      data-width={w}
      data-side={side}
      data-surface={surface}
      data-resizable={on ? 'true' : undefined}
      {...rest}
      id={on ? id : rest.id}
    >
      {(title || actions) && (
        <header className="ui-panel-head">
          {title && <span className="ui-panel-title" id={on ? titleId : undefined}>{title}</span>}
          {actions && <div className="ui-panel-actions">{actions}</div>}
        </header>
      )}
      <div className="ui-panel-body">{children}</div>
      {on && (
        <div
          className="ui-panel-handle"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-labelledby={title ? titleId : rest['aria-labelledby']}
          aria-label={title || rest['aria-labelledby'] ? undefined : rest['aria-label']}
          aria-controls={id}
          aria-valuemin={min}
          aria-valuemax={widest}
          aria-valuenow={shown}
          aria-valuetext={`${shown} pixels`}
          {...handlers}
        />
      )}
    </aside>
  )
}

export default Panel
