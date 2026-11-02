// =============================================================================
// navigation.js — pan, zoom and pinch on the world (MO2a, the brief's item 3).
//
// Binds pointer and wheel events on the graph's canvas to a renderer: one
// pointer drags the world, two pointers pinch, the wheel zooms at the cursor.
// `shouldStart(event)` lets the page claim a press for itself (a press on a
// dot is MO2's link and move gestures, brief §4.2): return false and the
// press never pans. The pen and touch adaptation of the HUD (brief §12a.11)
// is MO2's; this only moves the camera.
// =============================================================================

import { pinch, wheelFactor } from './camera.js'

export function bindNavigation(element, renderer, { shouldStart = () => true, wheel = true } = {}) {
  const pointers = new Map() // pointerId -> { x, y }
  const local = (e) => {
    const r = element.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function down(e) {
    if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return
    if (pointers.size === 0 && !shouldStart(e)) return
    if (pointers.size >= 2) return
    pointers.set(e.pointerId, local(e))
    if (typeof element.setPointerCapture === 'function') {
      try { element.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    }
  }

  function move(e) {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const p = local(e)
    if (pointers.size === 1) {
      renderer.panBy(p.x - prev.x, p.y - prev.y)
    } else if (pointers.size === 2) {
      // One finger moved: pinch about the still one.
      const [, other] = [...pointers].find(([id]) => id !== e.pointerId)
      renderer.setCamera(pinch(renderer.camera(), renderer.viewport(), prev, other, p, other))
    }
    pointers.set(e.pointerId, p)
  }

  function up(e) {
    pointers.delete(e.pointerId)
  }

  function onWheel(e) {
    e.preventDefault()
    const p = local(e)
    renderer.zoomAt(wheelFactor(e.deltaY, e.deltaMode), p.x, p.y)
  }

  element.addEventListener('pointerdown', down)
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', up)
  if (wheel) element.addEventListener('wheel', onWheel, { passive: false })
  return function unbind() {
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', up)
    if (wheel) element.removeEventListener('wheel', onWheel)
    pointers.clear()
  }
}
