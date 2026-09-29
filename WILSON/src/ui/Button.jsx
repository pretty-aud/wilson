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
//
// ── Two props F3 added, both from a lane that had already hit the hole ──────
//
//   Icon / icon   D1 kit request 3. `Badge`, `Banner`, `EmptyState`,
//                 `IconButton` and `Menu` all took one and this did not, so
//                 `Icon={X}` landed in `rest` and React was handed a
//                 function-valued DOM attribute — silently, with no icon
//                 drawn. ⚠️ D1 counted thirteen call sites at the time and
//                 then FIXED them all with a local wrapper that turns the
//                 prop back into a child (`SmallButton` in
//                 StorageConnections.jsx), so the count in the tree today is
//                 zero and this prop has no direct caller yet. It exists so
//                 the next one does not have to find this out again. Same
//                 spelling as IconButton's so a caller never has to remember
//                 which is which. An icon CHILD still works and is still
//                 sized by `.ui-btn > svg`, which is what the wrapper uses.
//
//   loading       D2 kit request K3. Owns the whole busy state: the button
//                 disables itself, announces `aria-busy`, swaps the glyph for
//                 a spinner in its own ink, and takes `loadingLabel` when the
//                 copy changes too ("Save" → "Saving…"). Five auth surfaces
//                 hand-rolled the label half of this and none of them
//                 disabled or announced anything.
// =============================================================================

import { forwardRef } from 'react'
import { Spinner } from './Spinner'

export const BUTTON_VARIANTS = Object.freeze(['primary', 'secondary', 'ghost', 'danger'])
export const BUTTON_SIZES = Object.freeze(['sm', 'md'])

export const Button = forwardRef(function Button(
  {
    variant,
    size,
    surface = 'dark',
    Icon,
    icon,
    loading = false,
    loadingLabel = null,
    disabled = false,
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
  const Glyph = Icon || icon
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
      disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {/* The spinner takes its colours from `currentColor` in index.css, so
          it is the button's own ink in every variant on every surface —
          white inside a filled primary, `ink-light` inside a light
          secondary — with no prop deciding it. Hidden from the a11y tree:
          `aria-busy` on the button is what announces the state. */}
      {loading
        ? <Spinner size={s} aria-hidden="true" />
        : Glyph ? <Glyph aria-hidden="true" /> : null}
      {loading && loadingLabel != null ? loadingLabel : children}
    </button>
  )
})

export default Button
