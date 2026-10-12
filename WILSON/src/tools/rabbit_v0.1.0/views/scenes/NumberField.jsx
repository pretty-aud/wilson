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
// its validation and every caller's onChange are untouched; this is display
// only. The browser's spinner is put away and the field draws its own
// chevrons in the room rabbitScenes.css keeps at its right edge, a clear gap
// from the figure. Past five digits, while the field is not focused, the
// figure shows its first five and an ellipsis; the full number is the
// field's title, and the field itself still holds it — a screen reader, a
// copy and the next keystroke all meet the real value — and on focus the
// whole figure comes back to be typed into.
//
// A chevron steps by one, never below `min` when one is given, and reaches
// the caller as the browser's spinner did: the value set through the
// element's own setter and an `input` event, so React hands the caller's
// onChange a real event (a figure the caller refuses — a negative scene
// number — goes back, as it did). The chevrons are not tab stops (the arrow
// keys step a focused field, as before); pressing one keeps the focus in
// the field, bringing it there first, so the figure shown is the whole one.
// A disabled field has none.
// ============================================================

import { useRef, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import '../rabbitScenes.css'

/** Figures an unfocused field shows before its ellipsis (her "after 5 digits"). */
const SHOWN = 5

/** The first five figures and an ellipsis, for a whole number past five; null otherwise. */
function capOf(text) {
  return /^\d+$/.test(text) && text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : null
}

export default function NumberField({ value, onChange, min, disabled = false, placeholder, className = '', 'aria-label': label }) {
  const ref = useRef(null)
  const [focused, setFocused] = useState(false)
  const text = value == null ? '' : String(value)
  const cap = capOf(text)
  const capped = cap != null && !(focused && !disabled)

  const step = (by) => {
    const el = ref.current
    if (!el || el.disabled) return
    const now = parseInt(el.value, 10)
    let next = (Number.isFinite(now) ? now : 0) + by
    if (min != null && next < min) next = min
    if (next === now) return
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(next))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // A press: no focus for the chevron, the field's own instead.
  const keepFocus = (e) => { e.preventDefault(); ref.current?.focus() }

  return (
    <span className={`rb-scene-number ${className}`.trim()} data-capped={capped ? 'true' : undefined}>
      <input
        ref={ref}
        type="number"
        min={min}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
            onMouseDown={keepFocus} onClick={() => step(1)}>
            <ChevronUp aria-hidden="true" />
          </button>
          <button type="button" tabIndex={-1} className="rb-scene-number-btn" aria-label={`Decrease ${label}`}
            onMouseDown={keepFocus} onClick={() => step(-1)}>
            <ChevronDown aria-hidden="true" />
          </button>
        </span>
      )}
    </span>
  )
}
