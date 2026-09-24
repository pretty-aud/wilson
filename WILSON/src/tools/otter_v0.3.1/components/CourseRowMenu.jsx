// =============================================================================
// CourseRowMenu — Session 11
//
// The actions menu on a course row. Everything Session 11 adds to an EXISTING
// course — sharing, the company-standard designation, suggesting a change,
// taking a copy, moving to trash — hangs off this one control rather than
// growing new views.
//
// NOTE ON "the course row's existing actions": there weren't any. O.T.T.E.R.
// shipped `renderDeleteConfirm` and `showDeleteConfirm` in Otter.jsx but nothing
// ever set the state truthy, so the course delete dialog has been unreachable
// dead code and there was no way at all to remove a course from the UI. This
// menu is therefore an addition rather than a reuse, and it finally gives that
// dialog a way in.
//
// POSITIONING: fixed, from the trigger's bounding rect. Sidebar 1 is a 200px
// column with `overflow-hidden` on the aside and `overflow-y-auto` on the list,
// so a normally-positioned dropdown is clipped on two axes. Measuring on open
// keeps the menu inside the window without a portal.
//
// PHASE 5 (2026-08-12) — THIS MENU WAS UNFINDABLE, WHICH MADE THE WHOLE SHARING
// MODEL UNFINDABLE. It is the only route to a course's tier, so "how do I submit
// a course company-wide?" had no answer a user could see. Three things changed:
// the trigger is no longer hidden until hover (the wrappers in Otter.jsx), it
// now meets contrast and target-size minimums, and the item says "submit".
// The menu is still filtered by capability — that part was right.
//
// UX LAWS APPLIED
//   Jakob's Law         A "⋯" opening a small menu is the pattern every file
//                       manager and document app already taught. Those apps
//                       draw it at readable contrast and 24px+, and back it
//                       with a right-click menu; hiding it until hover at
//                       1.35:1 kept the affordance and lost the teaching.
//   Fitts's Law         Destructive "Move to trash" sits last and separated by
//                       a rule, so it is never adjacent to Sharing.
//   Hick's Law          Items are filtered by capability, not disabled — a menu
//                       of four live options beats eight with half greyed out.
//   Von Restorff        Exactly one item is red. Everything else is uniform.
//   Cognitive Bias      Trash confirms (in Otter.jsx's existing dialog) rather
//                       than firing on click.
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MoreHorizontal, Share2, Copy, Trash2, MessageSquarePlus,
} from 'lucide-react'
import { canManageEditors, selectableVisibilities, canReadCourse } from './otterSharing.js'
import { IconButton } from '../../../ui'

const MENU_WIDTH = 200
// The kit menu's geometry (index.css `.ui-menu`, `.ui-menu-item`,
// `.ui-menu-divider`), so place() flips at the height the menu will draw.
const MENU_ITEM_H = 28      // `.ui-menu-item` min-height: --control-sm
const MENU_CHROME_H = 19    // 4px padding top and bottom, 1px edges, the divider's 1 + 4 + 4
const VIEWPORT_PAD = 8

export default function CourseRowMenu({
  course, role, onShare, onSuggestChange, onFork, onTrash, compact = false,
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  // Capability flags are derived from props with no hooks, so they can live
  // above the effects — place() needs the item count to know how tall the menu
  // will be before it is rendered.
  const isOwn      = course?.is_own !== false
  const isAdmin    = role === 'admin'
  const mayShare   = selectableVisibilities(course, role).length > 0 || canManageEditors(course, role)
  const mayFork    = canReadCourse(course)
  const maySuggest = !!course?.source_course_id && canReadCourse(course)
  // Mirrors fn_otter_trash_authz's course arm: owner or admin. Granted editors
  // may edit content but never bin someone else's course.
  const mayTrash   = isOwn || isAdmin

  const items = [
    // PHASE 5 label: "Sharing…" was the only route to the company library and it
    // never said so. Audrey (2026-08-10) went looking for how to "submit" a
    // course company-wide and could not find this item. The verb she searched
    // for now appears in the one place she would have looked.
    mayShare   && { key: 'share',   label: 'Share or submit…',  Icon: Share2,            run: onShare },
    maySuggest && { key: 'suggest', label: 'Suggest a change…', Icon: MessageSquarePlus, run: onSuggestChange },
    mayFork    && { key: 'fork',    label: 'Make my own copy',  Icon: Copy,              run: onFork },
  ].filter(Boolean)

  const menuHeight = (items.length + (mayTrash ? 1 : 0)) * MENU_ITEM_H + MENU_CHROME_H

  // The trigger's label must name the actions that are ACTUALLY in the menu.
  // A fixed "share, submit, copy or trash" was wrong for most rows: on a
  // colleague's shared course — and on every company-standard course, which is
  // is_own:false for everyone but its owner — mayShare, maySuggest and mayTrash
  // are all false and the menu holds one item, "Make my own copy". Promising
  // "submit" there and then not offering it is worse than the silence this
  // phase set out to fix. Derived from the same flags the items are.
  const verbs = [
    mayShare   && 'share or submit',
    maySuggest && 'suggest a change',
    mayFork    && 'copy',
    mayTrash   && 'move to trash',
  ].filter(Boolean)
  const verbList = verbs.length > 1
    ? `${verbs.slice(0, -1).join(', ')} or ${verbs[verbs.length - 1]}`
    : (verbs[0] ?? 'actions')

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Flip above the trigger when opening downwards would push the menu off the
    // bottom — the bottom-most row of a scrolled 200px sidebar is exactly where
    // this menu is most likely to be used, and an unclamped `top: r.bottom + 2`
    // put it below the fold with no way to scroll to it (the menu is fixed, and
    // any scroll closes it).
    const below = r.bottom + 2
    const wouldOverflow = below + menuHeight > window.innerHeight - VIEWPORT_PAD
    const top = wouldOverflow
      ? Math.max(VIEWPORT_PAD, r.top - menuHeight - 2)
      : below
    setPos({
      left: Math.max(VIEWPORT_PAD, Math.min(r.left, window.innerWidth - MENU_WIDTH - VIEWPORT_PAD)),
      top,
    })
  }, [menuHeight])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    // Any scroll or resize invalidates a fixed position measured from the row.
    const onMove = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  if (items.length === 0 && !mayTrash) return null

  return (
    <>
      {/* PHASE 5 — CONTRAST AND TARGET SIZE, restated for A3.
            The glyph was stone-600 at 1.35:1 on a hovered sidebar row, 1.99:1
            on a library card and 2.29:1 on the course header; WCAG 1.4.11
            wants 3:1 for a UI component, and this is the ONLY route to the
            sharing model. It is now the kit's IconButton: ink-2 at rest
            (8.49:1 on paper), and its own square for a hit box — 28x28
            compact (the sidebar) and 36x36 — clearing WCAG 2.2 2.5.8, where
            icon-plus-padding gave 24x24 and 30x30 (16x16 / 22x22 before
            PHASE 5). The open branch, dead until A3 (see otter.css), holds
            the kit's hover while the menu is open. */}
      <IconButton
        ref={btnRef}
        size={compact ? 'sm' : 'md'}
        icon={MoreHorizontal}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${course?.name ?? 'course'} — ${verbList}`}
        title={verbList.charAt(0).toUpperCase() + verbList.slice(1)}
        className="otter-row-menu-trigger"
        data-open={open ? 'true' : undefined}
      />

      {/* The kit Menu's surface and items (its classes), on this component's
          own element: the kit Menu has no menu roles yet and this one does,
          and its placement (flip above near the bottom edge, close on any
          scroll) is this component's. */}
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          onClick={e => e.stopPropagation()}
          className="ui-menu otter-row-menu"
          data-surface="dark"
          style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
        >
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.run?.(course) }}
              className="ui-menu-item"
            >
              <item.Icon aria-hidden="true" />
              <span className="ui-menu-item-label">{item.label}</span>
            </button>
          ))}

          {mayTrash && (
            <>
              {items.length > 0 && <div className="ui-menu-divider" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onTrash?.(course) }}
                className="ui-menu-item"
                data-danger="true"
              >
                <Trash2 aria-hidden="true" />
                <span className="ui-menu-item-label">Move to trash</span>
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
