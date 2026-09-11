// =============================================================================
// Drawer — the one docked side panel that overlays (plan §4).
//
// ── THE TITLE BAR OFFSET, which is the reason this component exists ──────────
//
// Electron draws WILSON's own 32px title bar, fixed at the top of the window
// on every screen. Nobody reviewed it, and three separate surfaces
// hand-compensate for it in three different ways: O.T.T.E.R.'s settings panel
// with a paddingTop, TimelineView's SettingsPanel with its own, and
// EditHistoryDrawer with none at all — so that one slides UNDER the title bar
// and loses its header (TL-24). It is the only chrome above the orange frame,
// it is on every screen, and it is the one height every overlay in the app has
// to know.
//
// It is ONE token now. `--titlebar-offset` is 0 in the browser and
// `--titlebar` (32px) under `.electron-app`, the class TitleBar already puts
// on <html> — so a drawer is written once and is correct in both builds, and
// no surface has to know whether it is running in Electron. Any fixed overlay
// that must clear the title bar reads that token instead of a literal 32.
//
// Docked, not modal: a Drawer is a side panel you work beside, so it does NOT
// take the modal stack, the focus trap or the busy lock. A surface that needs
// those is a Dialog. Escape closes it (it is dismissible chrome), and the
// backdrop is opt-in because the surfaces it replaces do not have one.
// =============================================================================

import { useEffect, useRef } from 'react'

const WIDTHS = ['sm', 'md', 'lg']

export function Drawer({
  open,
  onClose,
  title,
  actions,
  children,
  footer,
  side = 'right',
  width = 'md',
  backdrop = false,
  surface = 'dark',
  label,
  className = '',
  ...rest
}) {
  const ref = useRef(null)
  if (import.meta.env?.DEV && !WIDTHS.includes(width)) console.error(`Drawer: unknown width "${width}"`)

  useEffect(() => {
    if (!open || !onClose) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Never over a Dialog: a modal owns Escape while it is open (the kit's
      // overlay stack is what decides that), and a drawer behind one must not
      // steal the key from it.
      if (document.querySelector('.ui-dialog')) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {backdrop && (
        <div
          className="ui-drawer-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        ref={ref}
        className={`ui-drawer ${className}`.trim()}
        data-side={side}
        data-width={width}
        data-surface={surface}
        role="complementary"
        aria-label={label || (typeof title === 'string' ? title : 'Panel')}
        {...rest}
      >
        {(title || actions) && (
          <header className="ui-drawer-head">
            {title && <span className="ui-drawer-title">{title}</span>}
            {actions && <div className="ui-drawer-actions">{actions}</div>}
          </header>
        )}
        <div className="ui-drawer-body">{children}</div>
        {footer && <footer className="ui-drawer-foot">{footer}</footer>}
      </aside>
    </>
  )
}

export default Drawer
