// =============================================================================
// SettingsChrome — the row contract for System Settings (UI overhaul D1).
//
// Plan §5, bundle D1: "One row contract (label left, control right, one
// column, one row height)". Made exact here so that every section of every
// tab is the same object, and so that the sixteen distinct type treatments
// the review counted (S1) collapse to four components.
//
//   Section  H2 16px sentence case 600, a hairline above, an optional Dense
//            description capped at the reading measure, an optional actions
//            slot on the right. Replaces twelve hand-written copies of
//            `<h2 className="text-sm font-bold uppercase tracking-widest">`
//            plus the two `<h3 className="text-xs">` outliers that made the
//            Models and Agent Skills headings a different rank from their
//            peers (S13).
//   Group    An 11px Label eyebrow over a set of rows, 8px within the group
//            against 24px between groups.
//   Row      36px minimum, label left at the Label step, control right,
//            hairline between rows, description under the label.
//   Note     A bordered aside for copy that has no control (S16).
//
// 🚨 WHY THESE ARE LOCAL AND NOT IN `src/ui/`. `SectionTitle` and `Card` are
// Foundation 2's, and F2 has not landed — `src/ui/` currently carries F1's
// twenty primitives and nothing else. `src/ui/` is not this session's to
// append to (plan §6.5), so the contract is built here against F1's tokens
// and filed as a kit request in the hand-off. When F2 lands, these four
// components become re-exports and every caller below keeps working.
//
// 🚨 WHY THERE IS NO `> *` OR `:first-child` SELECTOR IN THE ROW CSS.
// `GatedAction` renders an extra wrapping `<span>` when a control is denied,
// so the number and box model of a row's flex children differ between an
// admin and a member. A contract expressed through child selectors or gap
// arithmetic would lay out differently for the two roles. Rows own their own
// spacing instead.
//
// Surface: Settings is a light page (plan §2 Q1 option A) on `#f4a261` with
// `#1c1917` as its only ink (C6), and no white, cream or pale grey surface
// may appear on it (C9). Raised surfaces are `well-light`; hierarchy comes
// from size and weight, never from a second ink.
// =============================================================================

import './settings.css'

/**
 * A region of the page. The hairline above is what separates one region from
 * the next — not a filled bar, not a bordered box (plan §4, SectionTitle).
 *
 * `first` drops the hairline and the top margin for the first section in a
 * tab, so a tab does not open with a rule hanging under the tab bar.
 */
export function Section({ title, description, actions, first = false, children }) {
  return (
    <section className="s-section" data-first={first}>
      <div className="s-section-head">
        <div className="s-section-heading">
          <h2 className="s-section-title">{title}</h2>
          {description && <p className="s-section-desc">{description}</p>}
        </div>
        {actions && <div className="s-section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * A named set of rows inside a section. This is the whole of the visual-only
 * reframe for the Hick's-law findings on this surface (S14, H2, H5, H6, H7):
 * the grouping the review asked for, expressed as an eyebrow, a hairline and
 * the spacing scale, WITHOUT hiding anything. Every control stays visible and
 * reachable in the same number of clicks.
 */
export function Group({ label, actions, children }) {
  return (
    <div className="s-group">
      {(label || actions) && (
        <div className="s-group-head">
          {label && <span className="s-eyebrow">{label}</span>}
          {actions && <div className="s-group-actions">{actions}</div>}
        </div>
      )}
      <div className="s-rows">{children}</div>
    </div>
  )
}

/**
 * One setting. Label left at the Label step, control right, 36px minimum,
 * hairline above every row but the first of its group.
 *
 * `stacked` puts the control on its own line beneath the label, for controls
 * that need the full measure (a textarea, a path, a table). It keeps the same
 * label treatment and the same hairline, so a stacked row still reads as a
 * member of the set rather than as a different kind of object.
 */
export function Row({ label, description, htmlFor, stacked = false, children }) {
  return (
    <div className="s-row" data-stacked={stacked}>
      <div className="s-row-label">
        {label && (
          htmlFor
            ? <label className="s-label" htmlFor={htmlFor}>{label}</label>
            : <span className="s-label">{label}</span>
        )}
        {description && <p className="s-row-desc">{description}</p>}
      </div>
      {children != null && <div className="s-row-control">{children}</div>}
    </div>
  )
}

/**
 * Copy with no control. The review's S16: "AI Features" was an `<h2>` at the
 * same rank as Companion and Project files location, followed by two lines of
 * prose and nothing to set — a note wearing a section's clothes.
 */
export function Note({ children }) {
  return <p className="s-note">{children}</p>
}
