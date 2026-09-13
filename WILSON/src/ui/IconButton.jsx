// =============================================================================
// IconButton — 28 / 36, ghost by default, `title` required (plan §4), plus a
// 16px `xs` that may only be mounted INSIDE another component.
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
// control. New callers pass `icon` and 'xs' | 'sm' | 'md'.
//
// ── Why there is an `xs` and why it is not a third page size ────────────────
// §3.3 has exactly two control heights, 28 and 36, and that stands: a 16px
// target on a page would be wrong. `xs` is for a control mounted INSIDE
// another component, which on this surface is one case — `.ui-badge` is 20px
// tall, the smallest icon button was 28px, so a remove control put inside a
// badge grew the row, and the department chips had to give it a private 16px
// box of their own (C3b kit request 3). 16/10 is what that box measured. The
// badge is the affordance and this is its glyph, so the hit area is the chip's
// rather than this button's.
// =============================================================================

import { forwardRef } from 'react'

const SIZES = ['xs', 'sm', 'md']

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
  // 🚨 An unrecognised size used to reach `data-size` verbatim and match no
  // rule, so the button silently took the 36px default — the same silent-
  // wrong-answer shape Panel and Drawer fixed for `data-width="220px"`. It
  // falls back to the scale and says so in dev.
  const s = typeof size === 'number' ? 'sm' : (SIZES.includes(size) ? size : 'md')
  if (import.meta.env?.DEV && typeof size !== 'number' && s !== size) {
    console.error(`IconButton: unknown size "${size}" — using "md"`)
  }
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
