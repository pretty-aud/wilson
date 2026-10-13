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
//
// ⚠️ THERE IS NO `xs`, and C3b's request 3 is still open. F4 built one (16px
// box, 10px glyph, the measurements `.at-dept-remove` already declares) and
// then took it out again, because adopting it is a trade the kit cannot make
// on its own — see the F4 hand-off §4b. In short: that button renders 28x28
// today, which CLEARS the 24px minimum target size; the 16px version does
// not. Shrinking it buys 4px of chip height and costs an accessibility floor.
// That is a ruling, not a kit fix.
// =============================================================================

import { forwardRef } from 'react'

const SIZES = ['sm', 'md']

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
      data-active={active ? 'true' : undefined}
      data-danger={danger ? 'true' : undefined}
      data-surface={surface}
      {...rest}
    >
      {Glyph ? <Glyph aria-hidden="true" /> : children}
    </button>
  )
})

export default IconButton
