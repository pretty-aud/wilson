// ============================================================
// RABBIT — the shot list the Scenes tab is VIEWING (post-overhaul S3b)
// ============================================================
//
// D2 (Audrey, plan §0.1): the Scenes tab shows the list YOU are viewing —
// per person, per project, remembered — which may differ from the project's
// ACTIVE list (D10: every other tab shows the active one). The default, and
// the fallback, is the active list; an id that names an archived or a
// missing list falls back too, so a list someone archived since never
// greets you on the next visit.
//
// Two views are not lists and are never remembered: an ARCHIVED list opened
// on purpose (from "Archived…" in the picker or "Recently removed"), which
// reads like any list and is read-only, and the "Not in any list" bucket
// (Audrey 2026-09-30: S3a's unlistedScenes / unlistedShots, reachable only
// from here while a list is active). Both last for the visit to the tab.
//
// S3c reuses this hook for its edit selector: `mode` says what is on screen,
// `id` is what a write should name (addScene's / addShot's `listId`), and
// `scenes` / `shots` are the rows the tables, galleries, tiles and counts
// read (D20: the tiles total what is on screen).
//
// The remembered id is per person (the signed-in user; one shared key on the
// Local Server, which has no users) and per project, in localStorage under
// VIEWED_LISTS_KEY — the `rabbit_scene_saved_views` idiom (a JSON value read
// and written whole, every failure swallowed: a browser that refuses storage
// gets the active list each time).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'

export const VIEWED_LISTS_KEY = 'rabbit_scene_viewed_lists'
/** The "Not in any list" bucket's id in this hook (never a list's: list ids are uuids). */
export const UNLISTED = 'unlisted'

function readRemembered() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEWED_LISTS_KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

function writeRemembered(key, id) {
  try {
    const all = readRemembered()
    if (id) all[key] = id
    else delete all[key]
    localStorage.setItem(VIEWED_LISTS_KEY, JSON.stringify(all))
  } catch { /* storage refused: the active list next time */ }
}

/**
 * What the tab shows, from what this person chose and what exists now.
 *   remembered  the list id stored for this person and project (or null)
 *   session     { id, archived? } chosen this visit: UNLISTED, or a list
 *               opened from the archive (archived: true), else null
 *   shotLists   every list of the project, archived included
 *   activeId    project.active_shot_list_id
 * Returns { id, list, mode }:
 *   'list'      a live list                     — id its id
 *   'archived'  an archived list opened on purpose (read-only)
 *   'unlisted'  the "Not in any list" bucket    — id UNLISTED
 *   'pending'   the active list, not loaded yet (the provider reads it) —
 *               id the pointer, so a new scene still lands in it
 *   'none'      no list to show: every scene and shot (the project has no
 *               list, or no active one and none chosen) — id null
 */
export function resolveViewedList({ remembered, session, shotLists, activeId }) {
  const byId = new Map((shotLists || []).map(l => [l.id, l]))
  if (session?.id === UNLISTED) return { id: UNLISTED, list: null, mode: 'unlisted' }
  if (session?.id && session.archived) {
    const l = byId.get(session.id)
    if (l) return { id: l.id, list: l, mode: l.archived_at ? 'archived' : 'list' }
  }
  const mine = remembered ? byId.get(remembered) : null
  if (mine && !mine.archived_at) return { id: mine.id, list: mine, mode: 'list' }
  if (activeId) {
    const active = byId.get(activeId)
    if (!active) return { id: activeId, list: null, mode: 'pending' }
    if (!active.archived_at) return { id: active.id, list: active, mode: 'list' }
  }
  return { id: null, list: null, mode: 'none' }
}

/**
 * The scenes an "unlisted" view shows: the scenes in no live list, then the
 * scene of every shot in no live list whose own scene IS listed elsewhere —
 * the heading that shot sits under (S3a's "implied" scene, the same rule a
 * list follows), so every unlisted shot is reachable in the Scenes mode too.
 */
export function unlistedSceneRows({ unlistedScenes, unlistedShots, sceneById }) {
  const out = [...(unlistedScenes || [])]
  const seen = new Set(out.map(s => s.id))
  for (const sh of unlistedShots || []) {
    if (!sh.scene_id || seen.has(sh.scene_id)) continue
    const sc = sceneById?.(sh.scene_id)
    if (sc) { out.push(sc); seen.add(sc.id) }
  }
  return out
}

export function useViewedShotList({ ctx, personKey }) {
  const projectId = ctx?.project?.id || null
  const key = projectId ? `${personKey || 'local'}|${projectId}` : null
  const [remembered, setRemembered] = useState(() => (key ? readRemembered()[key] || null : null))
  const [session, setSession] = useState(null)
  // Another project, or another person on this machine: their own memory,
  // and the visit's choice ends.
  useEffect(() => {
    setRemembered(key ? readRemembered()[key] || null : null)
    setSession(null)
  }, [key])

  const shotLists = ctx?.shotLists
  const activeId = ctx?.project?.active_shot_list_id || null
  const resolved = useMemo(
    () => resolveViewedList({ remembered, session, shotLists, activeId }),
    [remembered, session, shotLists, activeId],
  )

  const scenesOf = ctx?.scenesOf
  const shotsOf = ctx?.shotsOf
  const unlistedScenes = ctx?.unlistedScenes
  const unlistedShots = ctx?.unlistedShots
  const sceneById = ctx?.sceneById
  const activeScenes = ctx?.scenes
  const activeShots = ctx?.shots
  const rows = useMemo(() => {
    const { id, mode } = resolved
    if (mode === 'list' || mode === 'archived') {
      return { scenes: scenesOf?.(id) || [], shots: shotsOf?.(id) || [] }
    }
    if (mode === 'unlisted') {
      return { scenes: unlistedSceneRows({ unlistedScenes, unlistedShots, sceneById }), shots: unlistedShots || [] }
    }
    // 'none' and 'pending': the provider's own rows — every scene and shot
    // while the project has no active list (or while it reads the one named).
    return { scenes: activeScenes || [], shots: activeShots || [] }
  }, [resolved, scenesOf, shotsOf, unlistedScenes, unlistedShots, sceneById, activeScenes, activeShots])

  /**
   * Show this list. A live list is remembered for this person and project;
   * `{ archived: true }` opens an archived one for this visit (read-only);
   * UNLISTED opens the "Not in any list" bucket for this visit; null goes
   * back to the default (the active list).
   */
  const view = useCallback((id, { archived = false } = {}) => {
    if (id === UNLISTED || archived) { setSession({ id, archived }); return }
    setSession(null)
    setRemembered(id || null)
    if (key) writeRemembered(key, id || null)
  }, [key])

  return { ...resolved, ...rows, view }
}
