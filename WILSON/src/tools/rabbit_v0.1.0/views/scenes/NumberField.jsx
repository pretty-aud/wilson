// ============================================================
// RABBIT — a number field of the Scenes tab (post-overhaul FX1)
// ============================================================
//
// Audrey, 2026-10-11: "for the frame count bar in the shot items … the
// chevrons are covering up the numbers. lets please make sure this can be
// seen correctly with spacing between each. after 5 digits, add ellipsis".
//
// Every number field of the shot rows and the popups: a shot's frame count
// (the scene table's nested shots, the shot table, an edit's cut, the shot
// popup) and the scene's and the shot's number (the two popups). Measured
// before (scripts/shot-number-fields-shots.mjs): the tables' field was 64px
// and the browser's spinner took 15px of it, leaving 31px for the figure;
// four of Geist's 13px tabular figures are 31.2px, so a four-digit count ran
// into the chevrons, and a five- or six-digit one was clipped at them
// ("12345" and "123456" both read "1234").
//
// It is still the <input type="number"> it was — its typing, its arrow keys,
// its wheel, its validation and every caller's onChange are the browser's
// and the callers' own; this is display only. The browser's spinner is put
// away and the field draws its own chevrons in the room rabbitScenes.css
// keeps at its right edge, a clear gap from the figure. Past five digits,
// while the field is not focused, the figure shows its first five and an
// ellipsis; the full number is the field's title, and the field itself still
// holds it — a screen reader, a copy and the next keystroke all meet the
// real value — and on focus the whole figure comes back to be typed into.
// The tables' field holds six figures whole (review round 1, R1-02): seven
// or more scroll inside it, as any field's text does, the whole number still
// its title (a million frames is 11.6 hours at 24 fps — not a shot's).
//
// A chevron steps by one, never below `min` when one is given, and reaches
// the caller as the browser's spinner did: the value set through the
// element's own setter and an `input` event, so React hands the caller's
// onChange a real event (a figure the caller refuses — a negative scene
// number — goes back, as it did). Held, it repeats at the browser's pace
// (review round 2, R2-01, measured in Blink: the first repeat 250ms after
// the press, then one every 50ms): the beat is kept against the page's
// clock, so a step whose re-render takes 40ms of its 50 does not stretch the
// next. Like the browser's, it keeps counting when the pointer slides off
// the chevron and stops when it is let go anywhere (a pointerup or a
// pointercancel on the window), when the field blurs or is disabled, at min,
// or when the last step did not stand — read at the next beat, because
// React puts a refused figure back only once the event it was offered in
// has finished (the press's own, for the first step). The chevrons are not
// tab stops; pressing one keeps the focus in the field, bringing it there
// first, so the figure shown is the whole one. A disabled field has none.
//
// A click steps only when no press of this chevron began it: element.click()
// and keyboard activation (detail 0), or a touch whose press landed on the
// field because the chevrons were not yet showing (R2-15: the browser's
// spinner stepped on that first tap). A pointer's own click — a mouse's, or
// an accessibility click, which Blink sends as pointerdown … click — has
// already stepped on its press.
//
// A figure typed with leading zeros ("007") is stored as the number (7) and
// React leaves the field's text alone, loosely equal; on blur the field
// shows what is stored (R1-07), so the cap and the title read it too.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import '../rabbitScenes.css'

/** Figures an unfocused field shows before its ellipsis (her "after 5 digits"). */
const SHOWN = 5
/** A held chevron: its first repeat DELAY_MS after the press, then one every
    REPEAT_MS — Blink's spinner, measured (FX1 review round 2, R2-01). */
const DELAY_MS = 250
const REPEAT_MS = 50

/** The first five figures and an ellipsis, for a whole number past five; null otherwise. */
function capOf(text) {
  return /^\d+$/.test(text) && text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : null
}

export default function NumberField({ value, onChange, min, disabled = false, placeholder, className = '', 'aria-label': label }) {
  const ref = useRef(null)
  const timer = useRef(null)
  const pressed = useRef(false)
  const [focused, setFocused] = useState(false)
  const text = value == null ? '' : String(value)
  const cap = capOf(text)
  const capped = cap != null && !(focused && !disabled)

  // The hold ends wherever the pointer is let go: the window hears it. One
  // function for the field's life, so the listener a press adds is the one
  // any later stop takes away.
  const stop = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = null
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }, [])
  // A field disabled while focused gets no blur React sees (R1-04): it is
  // not focused once it can be, and a held chevron stops with it.
  useEffect(() => {
    if (!disabled) return
    setFocused(false)
    stop()
  }, [disabled, stop])
  useEffect(() => stop, [stop])

  /** One step: the figure it offered the caller, or null when there was none to offer (at min). */
  const step = (by) => {
    const el = ref.current
    if (!el || el.disabled) return null
    const now = parseInt(el.value, 10)
    let next = (Number.isFinite(now) ? now : 0) + by
    if (min != null && next < min) next = min
    if (next === now) return null
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(next))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return String(next)
  }
  // A press: one step at once, then the repeat while held — each repeat only
  // if the last step stood (the field still shows the figure it offered),
  // each beat REPEAT_MS after the last one was DUE, not after it ran.
  const hold = (by) => (e) => {
    if (e.button > 0) return
    stop()
    pressed.current = true
    let due = performance.now() + DELAY_MS
    let offered = step(by)
    if (offered == null) return
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    const again = () => {
      if (ref.current?.value !== offered) { stop(); return }
      offered = step(by)
      if (offered == null) { stop(); return }
      const now = performance.now()
      do due += REPEAT_MS; while (due <= now)
      timer.current = setTimeout(again, due - now)
    }
    timer.current = setTimeout(again, Math.max(0, due - performance.now()))
  }
  const press = (by) => (e) => {
    if (e.detail === 0 || !pressed.current) step(by)
    pressed.current = false
  }
  // No focus for the chevron, the field's own instead.
  const keepFocus = (e) => { e.preventDefault(); ref.current?.focus() }
  const blur = () => {
    setFocused(false)
    stop()
    const el = ref.current
    if (el && text !== '' && el.value !== '' && el.value !== text) el.value = text
  }

  return (
    <span className={`rb-scene-number ${className}`.trim()} data-capped={capped ? 'true' : undefined}>
      <input
        ref={ref}
        type="number"
        min={min}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={blur}
        disabled={disabled}
        aria-label={label}
        title={cap != null ? text : undefined}
        className="ui-input rb-scene-number-input"
        data-size="sm"
        placeholder={placeholder}
      />
      {capped && <span className="rb-scene-number-cap" aria-hidden="true">{cap}</span>}
      {!disabled && (
        <span className="rb-scene-number-step">
          <button type="button" tabIndex={-1} className="rb-scene-number-btn" aria-label={`Increase ${label}`}
            onPointerDown={hold(1)} onMouseDown={keepFocus} onClick={press(1)}>
            <ChevronUp aria-hidden="true" />
          </button>
          <button type="button" tabIndex={-1} className="rb-scene-number-btn" aria-label={`Decrease ${label}`}
            onPointerDown={hold(-1)} onMouseDown={keepFocus} onClick={press(-1)}>
            <ChevronDown aria-hidden="true" />
          </button>
        </span>
      )}
    </span>
  )
}
