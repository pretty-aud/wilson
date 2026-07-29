// =============================================================================
// SidebarCollapse — Session 11
//
// The ONE authorised change to O.T.T.E.R.'s existing shell (Audrey, 2026-07-29:
// "For one of the sidebars, let the user hide it and pull it back with a button,
// similar to Claude and Notion"). It applies to Sidebar 1 — Software & Subjects,
// the outer navigation column, which is the column those two apps collapse.
//
// Deliberately built as ONE reusable mechanism. If Sidebar 2 — Lessons ever
// wants the same treatment it must reuse this, so O.T.T.E.R. never grows two
// different collapse behaviours for the user to learn.
//
// UX LAWS APPLIED (the skill has real purchase here — this is the one existing
// surface the session is allowed to touch):
//
//   Jakob's Law        Users already know this control from Claude and Notion.
//                      Same affordance (a chevron at the top of the column),
//                      same shortcut (Ctrl/Cmd + \), same result. Matching the
//                      expectation exactly beats inventing something better.
//   Fitts's Law        The reopen target is a full-height rail, not a hover
//                      hotspot, and the chevron sits at the SAME y-position
//                      whether the sidebar is open or closed — so the control
//                      never moves out from under the cursor that just used it.
//   Miller's Law       Fewer simultaneous panes while reading a lesson: this
//                      exists so `study` and `subject` get the width back.
//   Doherty Threshold  Pure CSS/state toggle, no await anywhere on the path.
//                      Persistence is fire-and-forget and never gates a render.
//   Selective Attention The collapsed rail is quiet — a hairline and one
//                      chevron — so it reads as an edge, not as content.
//
// PERSISTENCE: localStorage, NOT otter-settings.json. The settings file is
// served by a local-server route (`/api/otter-settings`) that does not exist in
// a browser, so anything stored there silently stops working in the Session 12
// web build (carry-forward gap #21). localStorage works in both hosts.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'

/** Reads a persisted flag without ever throwing — private-mode browsers and
 *  sandboxed iframes make localStorage access itself raise. */
function readFlag(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* persistence is a convenience; never let it break the toggle */
  }
}

/**
 * Collapse state for one sidebar.
 *
 * DEFAULT IS EXPANDED, exactly as O.T.T.E.R. has always been — a user who never
 * touches the button must not be able to tell anything changed. The lazy
 * useState initialiser reads storage once, so the first paint is already
 * correct and the sidebar never flashes open before collapsing.
 *
 * @param {string} storageKey
 * @param {object} [opts]
 * @param {boolean} [opts.shortcutEnabled=true] whether Ctrl/Cmd + \ is live.
 *        WILSON renders every page simultaneously and toggles `display`, so
 *        O.T.T.E.R. stays MOUNTED while the user is in RABBIT, Settings or the
 *        Admin Terminal. A window-level listener registered unconditionally
 *        would therefore fire — and silently persist a collapse — from pages
 *        that have no such sidebar. Callers pass `currentPage === 'otter'`.
 * @returns {{collapsed: boolean, toggle: () => void, expand: () => void}}
 */
export function useSidebarCollapse(storageKey, { shortcutEnabled = true } = {}) {
  const [collapsed, setCollapsed] = useState(() => readFlag(storageKey))

  const set = useCallback((next) => {
    setCollapsed(next)
    writeFlag(storageKey, next)
  }, [storageKey])

  const toggle = useCallback(() => set(!collapsed), [set, collapsed])
  const expand = useCallback(() => set(false), [set])

  // Ctrl/Cmd + \ — the shortcut both reference apps use. Deliberately NOT
  // gated on "is the user typing": Notion and Claude both toggle while a text
  // field has focus, and `\` carries no editing meaning with a modifier held.
  useEffect(() => {
    if (!shortcutEnabled) return undefined
    const onKeyDown = (e) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle, shortcutEnabled])

  return { collapsed, toggle, expand }
}

const SHORTCUT_HINT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
    ? '⌘ \\'
    : 'Ctrl + \\'

/**
 * The collapse control that lives INSIDE the expanded sidebar, in a slim strip
 * above the existing content. Right-aligned so it lines up with the rail's
 * chevron when collapsed.
 */
export function SidebarCollapseButton({ onCollapse, label = 'Hide sidebar' }) {
  return (
    <div className="flex items-center justify-end h-6 px-1 border-b border-stone-700/60 shrink-0">
      <button
        type="button"
        onClick={onCollapse}
        title={`${label} (${SHORTCUT_HINT})`}
        aria-label={label}
        aria-expanded="true"
        className="p-1 rounded-sm text-stone-500 hover:text-orange-400 hover:bg-stone-700 transition-colors"
      >
        <ChevronsLeft className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/**
 * The collapsed state: a persistent full-height rail. Never a hover-only
 * target, and never a control that disappears along with the thing it reopens —
 * the whole rail is clickable, and the chevron sits at the same height the
 * collapse button occupied.
 */
export function SidebarReopenRail({ onExpand, label = 'Show sidebar' }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`${label} (${SHORTCUT_HINT})`}
      aria-label={label}
      aria-expanded="false"
      className="group w-6 shrink-0 bg-stone-800 border-r-2 border-stone-600 flex flex-col items-center hover:bg-stone-700 transition-colors cursor-pointer"
    >
      <span className="flex items-center justify-center h-6 w-full">
        <ChevronsRight className="w-3.5 h-3.5 text-stone-500 group-hover:text-orange-400 transition-colors" />
      </span>
    </button>
  )
}
