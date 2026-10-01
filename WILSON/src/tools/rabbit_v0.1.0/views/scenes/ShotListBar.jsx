// ============================================================
// RABBIT — the shot-list bar (post-overhaul S3b, step 3; D7)
// ============================================================
//
// One row between the Scenes tab's tiles and its toolbar (D7: the toolbar's
// sixteen controls stay as built). On the kit Toolbar — 44px, the 24px
// gutter, one hairline under it, a left slot that may shrink and a right
// slot that never does — because the bar IS a control row with an identity
// on the left and verbs on the right. The tab strip's geometry was the other
// candidate and was refused: its row is navigation, and the list's name set
// in it would read as a tab you could leave by (Jakob's law).
//
// Left: what you are viewing. The Label-step eyebrow "Shot list", then the
// list as "Title · v3" (D14) at the H3 weight, its summary on hover; then
// its state — the kit's Active badge (the bar's one coloured mark), or
// "Archived" / "Withdrawn" for one opened from the archive, or, beside a
// list that is not the active one, "Active: Other · v2" as a quiet button
// that shows that list; then whether it has changed since its last version
// point ("Not saved since changes" / "Never saved" / "Saved 30/09/2026").
// "Recently removed: Title · vN" with Open and Restore follows while S3a's
// recentlyWithdrawn is set (Audrey, 2026-09-30).
//
// Right, in the brief's order: New shot list and Shot lists… — the two
// buttons she asked for, the bar's two bordered doors — then, after a
// divider, the verbs on the list on screen as quiet buttons: Save, Save as…,
// Set active (hidden when it already is; greyed with the reason for a seat
// that may not, the GatedAction way). Hick's law: nothing else on the bar;
// the rare verbs (Add from another list…, Edit details…, Clear, Withdraw,
// Archive, Restore) live in the More menu at its end and in the picker.
// Von Restorff: no button here is filled — the page's one orange stays the
// toolbar's New scene / New shot.
// ============================================================

import { Plus } from 'lucide-react'
import { Toolbar, Button, StatusBadge } from '../../../../ui'
import GatedAction from '../../../../permissions/GatedAction'
import { showDate } from '../../dates'
import MenuButton from './MenuButton'
import '../rabbitScenes.css'

/** The words for what is on screen when it is not one list. */
function viewName(viewed, hasLiveList) {
  if (viewed.mode === 'unlisted') return 'Not in any list'
  if (viewed.mode === 'pending') return 'Loading the active list…'
  return hasLiveList ? 'Every scene and shot' : 'No shot list yet'
}

/**
 * The bar. Everything it shows is handed in; every verb is a callback the
 * container (ShotLists) owns, with its dialogs and its refusals.
 *   viewed      useViewedShotList's { id, list, mode }
 *   activeList  the project's active list row, or null
 *   hasLiveList whether the project has any list that is not archived
 *   saveState   { kind: 'never' | 'changed' | 'saved', at? } for the list on screen
 *   withdrawn   the list on screen was set aside by its maker (isWithdrawn)
 *   recent      S3a's recentlyWithdrawn for a list, or null
 *   gate        { write, writeReason, activate, activateReason }
 *   on          { newList, openPicker, save, saveAs, setActive, showList, openRecent, restoreRecent }
 *   moreItems   the More menu's kit Menu items (empty: no menu)
 */
export default function ShotListBar({ viewed, label, activeList, activeLabel, hasLiveList, saveState, saving = false, withdrawn, recent, recentLabel, gate, on, moreItems }) {
  const { mode, list } = viewed
  const onList = mode === 'list' || mode === 'archived'
  const isActive = mode === 'list' && !!activeList && activeList.id === list?.id
  const saveNote = !onList ? null
    : saveState?.kind === 'never' ? 'Never saved'
    : saveState?.kind === 'changed' ? 'Not saved since changes'
    : saveState?.kind === 'saved' ? `Saved ${showDate(saveState.at)}`
    : null

  const right = (
    <>
      <GatedAction allowed={gate.write} reason={gate.writeReason}>
        <Button size="sm" Icon={Plus} onClick={on.newList}>New shot list</Button>
      </GatedAction>
      <Button size="sm" onClick={on.openPicker}>Shot lists…</Button>
      {onList && (
        <>
          <span className="rb-scene-divider" aria-hidden="true" />
          {mode === 'list' && (
            // Saving an unchanged list would record the same point again.
            <GatedAction allowed={gate.write && saveState?.kind !== 'saved'}
              reason={gate.write ? `Nothing has changed since it was saved on ${showDate(saveState?.at)}.` : gate.writeReason}>
              {/* Busy while a Save runs (review round 1, R1-13). */}
              <Button size="sm" variant="ghost" loading={saving} onClick={on.save}>Save</Button>
            </GatedAction>
          )}
          <GatedAction allowed={gate.write} reason={gate.writeReason}>
            <Button size="sm" variant="ghost" onClick={on.saveAs}>Save as…</Button>
          </GatedAction>
          {mode === 'list' && !isActive && (
            <GatedAction allowed={gate.activate} reason={gate.activateReason}>
              <Button size="sm" variant="ghost" onClick={on.setActive}>Set active</Button>
            </GatedAction>
          )}
        </>
      )}
      <MenuButton title="More shot list actions" items={moreItems} minWidth={240} />
    </>
  )

  return (
    <>
      {/* A named group (the kit Toolbar takes no role: it has no arrow-key
          model), so a screen reader hears where its controls belong. */}
      <Toolbar className="rb-scene-lists" right={right} role="group" aria-label="Shot list">
        <span className="rb-scene-lists-eyebrow">Shot list</span>
        <span className="rb-scene-lists-name" title={onList ? (list?.summary || label) : undefined} data-tone={onList ? undefined : 'quiet'}>
          {onList ? label : viewName(viewed, hasLiveList)}
        </span>
        {isActive && <StatusBadge status="active" />}
        {mode === 'archived' && <StatusBadge status="archived" label={withdrawn ? 'Withdrawn' : 'Archived'} />}
        {mode === 'list' && !isActive && activeList && (
          <Button size="sm" variant="ghost" title="Show the active list" onClick={() => on.showList(activeList.id)}>
            {`Active: ${activeLabel}`}
          </Button>
        )}
        {(mode === 'list' || mode === 'none') && !activeList && hasLiveList && (
          <span className="rb-scene-lists-note">No active list</span>
        )}
        {saveNote && <span className="rb-scene-lists-note" data-state={saveState?.kind === 'saved' ? 'saved' : 'unsaved'}>{saveNote}</span>}
        {recent && (
          <span className="rb-scene-lists-recent">
            <span className="rb-scene-divider" aria-hidden="true" />
            <span className="rb-scene-lists-recent-words">{`Recently removed: ${recentLabel}`}</span>
            <Button size="sm" variant="ghost" onClick={on.openRecent}>Open</Button>
            <Button size="sm" variant="ghost" onClick={on.restoreRecent}>Restore</Button>
          </span>
        )}
      </Toolbar>
    </>
  )
}
