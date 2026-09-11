// =============================================================================
// Tabs — the one tab bar (plan §4).
//
//   Body step (14px), sentence case, 400 inactive / 600 active, ONE 2px signal
//   underline, no fill, and an optional hairline group separator for sets
//   above nine.
//
// Four tab bars shipped at four sizes (11, 11, 12, 14), two cases, two accents
// (#f97316 and #ea580c) and three active treatments — one of them a filled
// #ea580c bar under 11px text, which is the orange rule broken by the very
// component that says where you are. The underline exists so the active tab
// never needs a fill: on this frame a fill under small text has no legal ink
// (C6).
//
//   items:  [{ id, label, count?, disabled? } | { separator: true }]
//
// A `{ separator: true }` entry is the group hairline, for a set large enough
// that equal-weight peers become a Hick's-law problem on their own
// (R.A.B.B.I.T.'s ViewTabs has eleven; no tab is removed — they are grouped).
//
// ── Keyboard ─────────────────────────────────────────────────────────────────
// Left/Right (and Home/End) move between tabs, because a tab bar that does not
// is a tab bar in name only. Every tab STAYS in the tab order rather than
// taking the ARIA pattern's roving tabindex: roving would change what the Tab
// key does on eleven existing surfaces, and C1 says behaviour does not change.
// Arrow keys are purely additive — nothing that worked stops working.
// =============================================================================

import { useRef } from 'react'

export function Tabs({
  items = [],
  value,
  onChange,
  surface = 'dark',
  label = 'Views',
  className = '',
  ...rest
}) {
  const ref = useRef(null)

  function onKeyDown(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const tabs = [...(ref.current?.querySelectorAll('button.ui-tab:not(:disabled)') || [])]
    const at = tabs.indexOf(document.activeElement)
    if (at === -1) return
    e.preventDefault()
    const next =
      e.key === 'Home' ? 0
        : e.key === 'End' ? tabs.length - 1
          : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
            : (at + 1) % tabs.length
    tabs[next].focus()
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className={`ui-tabs ${className}`.trim()}
      data-surface={surface}
      onKeyDown={onKeyDown}
      {...rest}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <span key={`sep-${i}`} className="ui-tabs-sep" aria-hidden="true" />
        }
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled || undefined}
            className="ui-tab"
            data-active={active || undefined}
            data-surface={surface}
            onClick={() => onChange?.(item.id)}
          >
            {item.label}
            {item.count != null && <span className="ui-tab-count">{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default Tabs
