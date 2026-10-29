// =============================================================================
// AnswerLink.jsx — a link in an answer: the `a` of the pet's markdown
// (PetCompanion) and of O.T.T.E.R.'s lessons (D3, night 7 of
// docs/sessions/PLAN_TO_1_0.md, 2026-10-29; docs/design/RECONNECT_DESIGN.md
// §14.3; OUTSTANDING D2-06).
//
// MEASURED on the tip (bb14b169, session-c): react-markdown's own anchor has
// no target, so on the web a click on a web link in an answer replaced
// WILSON's tab, and whatever was unsaved in it, with the site. A web address
// on another origin now opens in a new tab with rel="noopener noreferrer"
// (no way back to WILSON's page, no referrer sent), as O.T.T.E.R.'s subject
// sources already do. On the desktop the window's guard decides, unchanged
// (electron/windowGuard.cjs: a new window for a web address goes to the
// system browser, as the plain link's navigation did).
//
// Everything else stays the anchor it was: an email address (remark-gfm makes
// it a mailto: link; the desktop's guard hands it to the mail app), a
// relative address, a fragment, and an address on the page's own origin (a
// new tab there would hand the desktop's loopback address to the system
// browser). An address react-markdown emptied (its urlTransform empties
// javascript:, data:, blob: and every scheme it does not trust) is drawn as
// its text: an anchor with an empty address reloads WILSON's page on a click.
// react-markdown hands every component its `node`, which React would write on
// the anchor as an attribute: it is dropped.
// =============================================================================

/**
 * Does `href` open in a new tab: an http(s) address on another origin than
 * the page's? Read against the page's own address, so a protocol-relative
 * one (`//elsewhere.example/x`, which leaves the page as surely as an
 * absolute one) is caught too, and a relative one stays the page's.
 */
export function opensInANewTab(href, pageHref = globalThis.location?.href) {
  let u
  let page
  try { u = new URL(String(href), pageHref) } catch { return false }
  try { page = new URL(String(pageHref)) } catch { page = null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  return !page || u.origin !== page.origin
}

export default function AnswerLink({ node: _node, href, children, ...props }) {
  if (typeof href !== 'string' || href === '') return <span {...props}>{children}</span>
  if (opensInANewTab(href)) {
    return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  }
  return <a {...props} href={href}>{children}</a>
}
