// =============================================================================
// IconButton — 28 / 36, ghost by default, `title` required (plan §4).
//
// The `title` is the tooltip (no tooltip component is added, §3.3) and,
// unless an explicit `aria-label` is given, the accessible name; a missing
// title is reported in dev because an icon-only control with no name is a
// button a screen reader announces as "button". `active` is the one active
// treatment (the signal as a tint and a 1px edge, the ink unchanged), never
// the signal as a fill. States are data attributes resolved in index.css.
//
// binUi compatibility (Bins' IconBtn): `Icon` (capitalised) is the glyph
// component, and a numeric `size` (Tailwind units, e.g. 3.5) means the small
// control. New callers pass `icon` and 'sm' | 'md'.
// =============================================================================

import { forwardRef } from 'react'

export const IconButton = forwardRef(function IconButton(
  {
    Icon,
    icon,
    title,
    'aria-label': ariaLabel,
    size = 'md',
    active = false,
    danger = false,
    surface = 'dark',
    type = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const Glyph = Icon || icon
  const s = typeof size === 'number' ? 'sm' : size
  if (import.meta.env?.DEV && !title && !ariaLabel) {
    console.error('IconButton: `title` is required — it is the tooltip and the accessible name')
  }
  return (
    <button
      ref={ref}
      type={type}
      title={title}
      aria-label={ariaLabel || title}
      aria-pressed={active || undefined}
      className={`ui-iconbtn ${className}`.trim()}
      data-size={s}
      data-active={active || undefined}
      data-danger={danger || undefined}
      data-surface={surface}
      {...rest}
    >
      {Glyph ? <Glyph aria-hidden="true" /> : children}
    </button>
  )
})

export default IconButton
