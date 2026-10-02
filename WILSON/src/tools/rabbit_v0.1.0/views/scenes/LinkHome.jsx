// ============================================================
// RABBIT — a linked scene's or shot's shot list, beside its name
// (post-overhaul S3c, step 1)
// ============================================================
//
// "Shoot · v2 +1": the list that holds the row (the active one when it is
// among them), then "+N" for every other list and every edit that uses it,
// each named in the tooltip a line apiece (linkHomes.js). At the Caption
// step in the second ink, after the name: the name stays what is read first
// (Selective Attention), and the list sits where the eye already is
// (Proximity) instead of in a tooltip a person has to know to look for
// (Working Memory). For a screen reader the caption is read as the words it
// stands for, not as "+1".
//
// Where a table is dense (the Timeline's gutter, the Budget's reports) the
// tooltip alone carries it: those callers take `useHomeIndex` and set each
// row's title from it.
// ============================================================

import { useMemo } from 'react'
import { homeIndex, NO_LIST_WORDS } from './linkHomes'
import '../rabbitScenes.css'

/** The index (linkHomes.homeIndex) over the provider's rows, once per change of them. */
export function useHomeIndex(ctx) {
  const shotLists = ctx?.shotLists
  const shotListItems = ctx?.shotListItems
  const shots = ctx?.allShots || ctx?.shots
  const edits = ctx?.edits
  const activeId = ctx?.project?.active_shot_list_id || null
  return useMemo(
    () => homeIndex({ shotLists, shotListItems, shots, edits, activeId }),
    [shotLists, shotListItems, shots, edits, activeId],
  )
}

/**
 * ctx     useRabbit() — or `homeOf`, an index a table already holds
 * id      the scene's or shot's id
 * name    its name, the tooltip's first line
 */
export default function LinkHome({ ctx, homeOf, id, name }) {
  const own = useHomeIndex(homeOf ? null : ctx)
  const h = (homeOf || own)(id)
  const words = h.title(null).split('\n').join('. ')
  return (
    <span className="rb-scene-home" title={h.title(name)}>
      <span className="rb-scene-home-label" aria-hidden="true">{h.primary || NO_LIST_WORDS}</span>
      {h.more > 0 && <span className="rb-scene-home-more" aria-hidden="true">{`+${h.more}`}</span>}
      <span className="sr-only">{words}</span>
    </span>
  )
}
