// =============================================================================
// Button — the one button (plan §4, F33).
//
//   variant: 'primary' | 'secondary' | 'ghost' | 'danger'   (default secondary)
//   size:    'sm' (28px, Dense) | 'md' (36px, Body)          (default md)
//   surface: 'dark' | 'light'
//
// primary is `signal-fill` with white (5.18:1, Q16); it is the only filled
// variant, and there is one per region. Sentence case, weight 600, no
// tracking — the label is written by the caller, never transformed here.
// Disabled is the ink at 52 percent plus `cursor: not-allowed`, never an
// opacity. Every visual state is a data attribute resolved in src/index.css
// (`.ui-btn[data-variant]`), so no inline style can ever beat the hover.
//
// binUi compatibility (Bins' Btn, re-exported from there until B6): the
// boolean props `primary`, `danger` and `small` map onto variant and size.
// New callers use the named props.
// =============================================================================

import { forwardRef } from 'react'

export const BUTTON_VARIANTS = Object.freeze(['primary', 'secondary', 'ghost', 'danger'])
export const BUTTON_SIZES = Object.freeze(['sm', 'md'])

export const Button = forwardRef(function Button(
  {
    variant,
    size,
    surface = 'dark',
    // binUi aliases
    primary = false,
    danger = false,
    small = false,
    type = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const v = variant ?? (primary ? 'primary' : danger ? 'danger' : 'secondary')
  const s = size ?? (small ? 'sm' : 'md')
  if (import.meta.env?.DEV) {
    if (!BUTTON_VARIANTS.includes(v)) console.error(`Button: unknown variant "${v}"`)
    if (!BUTTON_SIZES.includes(s)) console.error(`Button: unknown size "${s}"`)
  }
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-btn ${className}`.trim()}
      data-variant={v}
      data-size={s}
      data-surface={surface}
      {...rest}
    >
      {children}
    </button>
  )
})

export default Button
