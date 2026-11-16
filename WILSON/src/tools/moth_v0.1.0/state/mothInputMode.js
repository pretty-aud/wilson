// mothInputMode.js — MO2: pen and touch, adaptive (her ruling, the brief §12a.11).
//
// The moment a pen or a finger touches the screen, Moth switches to its touch layout (larger targets); the moment
// a mouse moves again, it switches back. Browsers send mouse events of their own after a touch (the compatibility
// events), and a device with both may send a stray mouse event mid-gesture, so a mouse event soon after a touch or
// a pen does not count, and neither does a "move" of less than a few pixels: only a real movement of a real mouse
// switches back. The switch itself animates in CSS (moth.css), and never on reduced motion.
export const SYNTHETIC_MS = 800
export const MOUSE_MOVE_PX = 4

export function createInputMode({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), onChange = () => {}, initial = 'mouse' } = {}) {
  // From the page's own mode, so coming back to the page with the touch layout on, a real mouse still switches it off.
  let mode = initial === 'touch' ? 'touch' : 'mouse'
  let lastTouch = -Infinity
  let lastMouse = null
  const set = (next) => { if (next !== mode) { mode = next; onChange(mode) } }

  /** Feed it every pointerdown and pointermove (any target). */
  function handle(e) {
    const type = e?.pointerType
    if (type === 'touch' || type === 'pen') {
      lastTouch = now()
      lastMouse = null
      set('touch')
      return
    }
    if (type !== 'mouse') return
    if (now() - lastTouch < SYNTHETIC_MS) return // the browser's own, after a touch or a pen
    const at = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
    if (mode === 'touch') {
      if (e.type === 'pointerdown') { set('mouse'); lastMouse = at; return } // a real click is a real mouse
      if (!lastMouse) { lastMouse = at; return }
      if (Math.hypot(at.x - lastMouse.x, at.y - lastMouse.y) >= MOUSE_MOVE_PX) set('mouse')
      return
    }
    lastMouse = at
  }

  let target = null
  return {
    mode: () => mode,
    handle,
    /** Listen on a target (the window) while Moth is on screen; capture, passive, so nothing else is touched. */
    attach(t) {
      if (target || !t?.addEventListener) return
      target = t
      t.addEventListener('pointerdown', handle, { capture: true, passive: true })
      t.addEventListener('pointermove', handle, { capture: true, passive: true })
    },
    detach() {
      if (!target) return
      target.removeEventListener('pointerdown', handle, { capture: true })
      target.removeEventListener('pointermove', handle, { capture: true })
      target = null
    },
  }
}

/** The system's reduced-motion wish, read now (tests stub matchMedia, as AuthShell's do). */
export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
