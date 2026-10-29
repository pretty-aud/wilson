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
// An email address (remark-gfm makes it a mailto: link; the desktop's guard
// hands it to the mail app), a relative address, a fragment and an address on
// the page's own origin stay the plain anchor they were (a new tab at the
// page's own origin would hand the desktop's loopback address to the system
// browser). Anything else is drawn as its text, never a live anchor: an
// address react-markdown emptied (an anchor with an empty address reloads
// WILSON's page on a click) and every other scheme, javascript: and data:
// included — by this component itself, whatever renderer it is given to
// (react-markdown's own urlTransform empties those first today; build review
// round 1, F3). react-markdown hands every component its `node`, which React
// would write on the anchor as an attribute: it is dropped.
// =============================================================================

/**
 * What an answer's address is drawn as: 'tab' (a new tab), 'link' (the plain
 * anchor) or 'text'. Read against the page's own address, so a
 * protocol-relative one (`//elsewhere.example/x`, which leaves the page as
 * surely as an absolute one) counts as the other origin it is, and a relative
 * one as the page's.
 */
export function linkKind(href, pageHref = globalThis.location?.href) {
  if (typeof href !== 'string' || href === '') return 'text'
  let u
  try { u = new URL(href, pageHref) } catch { return 'text' }
  if (u.protocol === 'mailto:') return 'link'
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'text'
  let page = null
  try { page = new URL(String(pageHref)) } catch { /* no page: every web address is elsewhere */ }
  return page && u.origin === page.origin ? 'link' : 'tab'
}

/** Does `href` open in a new tab: an http(s) address on another origin than the page's? */
export function opensInANewTab(href, pageHref) {
  return linkKind(href, pageHref) === 'tab'
}

export default function AnswerLink({ node: _node, href, children, ...props }) {
  const kind = linkKind(href)
  if (kind === 'tab') return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  if (kind === 'link') return <a {...props} href={href}>{children}</a>
  return <span {...props}>{children}</span>
}
