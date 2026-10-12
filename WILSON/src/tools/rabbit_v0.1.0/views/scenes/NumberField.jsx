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
// It is still the <input type="number"> it was — its typing, its validation
// and every caller's onChange are untouched; this is display only. The
// browser's spinner is put away and the field draws its own chevrons in the
// room rabbitScenes.css keeps at its right edge, a clear gap from the figure.
// Past five digits, while the field is not focused, the figure shows its
// first five and an ellipsis; the full number is the field's title, and the
// field itself still holds it — a screen reader, a copy and the next
// keystroke all meet the real value — and on focus the whole figure comes
// back to be typed into. The tables' field holds six figures whole (FX1
// review round 1, R1-02): seven or more scroll inside it, as any field's
// text does, the whole number still its title (a million frames is 11.6
// hours at 24 fps — not a shot's).
//
// A chevron steps by one, never below `min` when one is given, and reaches
// the caller as the browser's spinner did: the value set through the
// element's own setter and an `input` event, so React hands the caller's
// onChange a real event (a figure the caller refuses — a negative scene
// number — goes back, as it did). Held, it repeats as the browser's did
// (R1-05): one step on the press, then one every REPEAT_MS after DELAY_MS,
// until the pointer lets go or leaves, the field blurs, or the figure stops
// moving. The chevrons are not tab stops; pressing one keeps the focus in
// the field, bringing it there first, so the figure shown is the whole one.
// A disabled field has none.
//
// 🚨 The arrow keys do NOT step these fields in the app, and did not step
// the browser's either: Home.jsx's document keydown listener cancels
// ArrowUp / ArrowDown on every page, and Enter after one of them opens a
// Home destination (OUTSTANDING P1-03, measured again by FX1's review round
// 1). The chevrons are the way to step; typing is the way to set.
//
// A figure typed with leading zeros ("007") is stored as the number (7) and
// React leaves the field's text alone, loosely equal; on blur the field
// shows what is stored (R1-07), so the cap and the title read it too.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import '../rabbitScenes.css'

/** Figures an unfocused field shows before its ellipsis (her "after 5 digits"). */
const SHOWN = 5
/** A held chevron: its first repeat after DELAY_MS, then one every REPEAT_MS. */
const DELAY_MS = 400
const REPEAT_MS = 50

/** The first five figures and an ellipsis, for a whole number past five; null otherwise. */
function capOf(text) {
  return /^\d+$/.test(text) && text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : null
}

export default function NumberField({ value, onChange, min, disabled = false, placeholder, className = '', 'aria-label': label }) {
  const ref = useRef(null)
  const timer = useRef(null)
  const [focused, setFocused] = useState(false)
  const text = value == null ? '' : String(value)
  const cap = capOf(text)
  const capped = cap != null && !(focused && !disabled)

  const stop = () => {
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = null
  }
  // A field disabled while focused gets no blur React sees (R1-04): it is
  // not focused once it can be, and a held chevron stops with it.
  useEffect(() => {
    if (!disabled) return
    setFocused(false)
    stop()
  }, [disabled])
  useEffect(() => stop, [])

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
  // A press: one step at once, then the repeat while held. Each repeat goes
  // on only if the last step stood — the field still shows the figure it
  // offered. A refused one is put back by React only once the event it was
  // offered in has finished (the press's own, for the first), so the check
  // is made at the next tick, never inside the step.
  const hold = (by) => (e) => {
    if (e.button > 0) return
    stop()
    let offered = step(by)
    if (offered == null) return
    const again = () => {
      if (ref.current?.value !== offered) { timer.current = null; return }
      offered = step(by)
      timer.current = offered == null ? null : setTimeout(again, REPEAT_MS)
    }
    timer.current = setTimeout(again, DELAY_MS)
  }
  // A click with no pointer behind it (a screen reader's): one step. A
  // pointer's click (detail 1) already stepped on its press.
  const press = (by) => (e) => { if (e.detail === 0) step(by) }
  // No focus for the chevron, the field's own instead.
  const keepFocus = (e) => { e.preventDefault(); ref.current?.focus() }
  const blur = () => {
    setFocused(false)
    stop()
    const el = ref.current
    if (el && text !== '' && el.value !== '' && el.value !== text && Number(el.value) === Number(text)) el.value = text
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
            onPointerDown={hold(1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
            onMouseDown={keepFocus} onClick={press(1)}>
            <ChevronUp aria-hidden="true" />
          </button>
          <button type="button" tabIndex={-1} className="rb-scene-number-btn" aria-label={`Decrease ${label}`}
            onPointerDown={hold(-1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
            onMouseDown={keepFocus} onClick={press(-1)}>
            <ChevronDown aria-hidden="true" />
          </button>
        </span>
      )}
    </span>
  )
}
