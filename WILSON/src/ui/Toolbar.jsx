// =============================================================================
// Toolbar — the one control strip above a view (plan §4).
//
//   44px tall, the one 24px gutter, a hairline underneath, a left slot
//   (children) and a right slot (`right`). NEVER wraps.
//
// Three heights, three gutters and two backgrounds became one of each, and —
// the part that actually shows — every child is the `sm` 28px control height,
// so the row has ONE baseline. Only one of the three toolbars it replaces
// established a baseline its controls shared; the others put a 30px input
// beside a 26px button beside a 34px chip and let flexbox centre them.
//
// `wrap` exists for a strip that genuinely holds more than fits (the Files
// explorer's six heterogeneous controls). It is opt-in because a toolbar that
// wraps by default hides the fact that it is over-full.
//
// 🚨 NO `role="toolbar"`. The role promises arrow-key navigation with a roving
// tabindex, and there is none — the same promise F1 refused to make for Menu
// (hand-off §5 trap 10: "do not add the role before the keyboard model
// exists"). It also may not own a `tablist`, which is exactly what the worked
// example puts inside it. It is a plain container; its children are ordinary
// tab stops, which is what they were before the kit existed.
// =============================================================================

export function Toolbar({ children, right, surface = 'dark', wrap = false, className = '', ...rest }) {
  return (
    <div
      className={`ui-toolbar ${className}`.trim()}
      data-surface={surface}
      data-wrap={wrap || undefined}
      {...rest}
    >
      <div className="ui-toolbar-slot">{children}</div>
      {right && <div className="ui-toolbar-slot ui-toolbar-right">{right}</div>}
    </div>
  )
}

export default Toolbar
