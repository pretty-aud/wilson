// ============================================================
// RABBIT — "Shot lists…", the picker (post-overhaul S3b, step 4)
// ============================================================
//
// Audrey: "the second button to open a pop up window that lists each shot
// list to select from. for the … table of shot lists, we need to see when
// it was create, the title/version number of the shotlist and … a
// summary/description … there should also be a button in this table that
// allows the user to create a new shotlist from this view as well."
//
// The kit Dialog at the reading width (720) holding a kit Table: Active
// (the bar's own badge, so the two read alike) · Title · Version · Created
// (dates.js's showDate) · Summary · the row's actions — newest first. A
// click selects a row (the kit Row's selected treatment); a double-click,
// Enter on its title, or the footer's Open shows it in the tab. Space on
// the title selects it. The footer: New shot list… on the left (the create
// button she asked for inside the table view), then Cancel and Open.
//
// A live row's actions are a menu of words, by seat (D8): Set active
// (managers and admins), Edit details…, Withdraw… (the maker of an
// untouched list, S3a), Archive… (managers and admins). Below the table, a
// divider, then "Not in any list (N)" — only while there are such rows and
// the project has a list to compare them with (Audrey 2026-09-30: just above
// "Archived…") — which selects and opens like a list; then "Archived…",
// the same table over the archived and withdrawn lists, each with Restore
// for whoever may (S3a: a manager or an admin; the maker of a row they
// withdrew). While S3a's recentlyWithdrawn is set, "Recently removed" with
// Open and Restore heads the picker. A refusal in here lands in the
// Dialog's error slot, in the backend's words.
// ============================================================

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ArrowLeft, ArchiveRestore } from 'lucide-react'
import { Dialog, Table, Th, Td, Row, Button, IconButton, StatusBadge, EmptyState } from '../../../../ui'
import GatedAction from '../../../../permissions/GatedAction'
import { showDate } from '../../dates'
import MenuButton from './MenuButton'
import { UNLISTED } from './useViewedShotList'
import '../rabbitScenes.css'

const byNewest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * lists        every list of the project (archived included)
 * activeId     the project's active list
 * viewedId     what the tab shows now (a list id, UNLISTED or null)
 * label        formatShotListLabel
 * isWithdrawn  S3a's: set aside by the person who made it
 * unlisted     { scenes, shots } — the counts of rows in no live list
 * recent       S3a's recentlyWithdrawn for a list, or null
 * rowMenu      (row) => the kit Menu items for a live row
 * restoreFor   (row) => a Restore handler for an archived row, or null
 * gate         { write, writeReason }
 * error        the Dialog's error slot
 * on           { open(id, { archived }), openUnlisted, openRecent, restoreRecent, newList, close }
 */
export default function ShotListPicker({ lists, activeId, viewedId, label, isWithdrawn, unlisted, recent, rowMenu, restoreFor, gate, error, on }) {
  const [view, setView] = useState('lists')
  const live = useMemo(() => (lists || []).filter(l => !l.archived_at).sort(byNewest), [lists])
  const archived = useMemo(() => (lists || []).filter(l => l.archived_at).sort(byNewest), [lists])
  const rows = view === 'archived' ? archived : live
  const [selected, setSelected] = useState(() => (viewedId === UNLISTED || live.some(l => l.id === viewedId) ? viewedId : null))
  const unlistedCount = (unlisted?.scenes || 0) + (unlisted?.shots || 0)
  const showUnlisted = view === 'lists' && unlistedCount > 0 && live.length > 0

  const open = (id) => {
    if (id === UNLISTED) on.openUnlisted()
    else on.open(id, { archived: view === 'archived' })
  }
  const switchTo = (v) => { setView(v); setSelected(null) }
  // The row's title: a button, so the keyboard reaches it — Space selects
  // (its click), Enter opens (a file dialog's Enter). The picker opens with
  // focus on the list on screen's (else the newest's), not on the ✕: the
  // keyboard starts where the choice is.
  const focusId = rows.some(l => l.id === selected) ? selected : rows[0]?.id
  const titleButton = (id, words) => (
    <button
      type="button"
      autoFocus={id === focusId}
      className="rb-scene-lists-pick"
      onClick={e => { e.stopPropagation(); setSelected(id) }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); open(id) } }}
    >
      {words}
    </button>
  )

  return createPortal(
    <Dialog
      width="reading"
      // In <body>, outside the app's dark-scrollbar root: it carries the
      // class itself, as the scene popups do (R1-12).
      className="wilson-dark-scroll"
      title={view === 'archived' ? 'Archived shot lists' : 'Shot lists'}
      subtitle={view === 'archived'
        ? 'Lists set aside by a manager or by the person who made them. Nothing in them is deleted: open one to read it, or restore it.'
        : 'Open a list to show it in this tab. The active list is the one every other tab shows.'}
      error={error}
      onClose={on.close}
      footer={(
        <>
          {/* At the footer's left (the popups' Delete's place); the class on
              both, since GatedAction draws its wrapper only when it greys. */}
          <GatedAction allowed={gate.write} reason={gate.writeReason} className="rb-scene-lists-foot-start">
            <Button Icon={Plus} className="rb-scene-lists-foot-start" onClick={on.newList}>New shot list…</Button>
          </GatedAction>
          <Button onClick={on.close}>Cancel</Button>
          <Button variant="primary" disabled={!selected} onClick={() => open(selected)}>Open</Button>
        </>
      )}
    >
      {recent && view === 'lists' && (
        <div className="rb-scene-lists-recent-row">
          <span className="rb-scene-lists-recent-words">{`Recently removed: ${label(recent.row)}`}</span>
          <Button size="sm" variant="ghost" onClick={on.openRecent}>Open</Button>
          <Button size="sm" variant="ghost" onClick={on.restoreRecent}>Restore</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={view === 'archived' ? 'No archived shot lists' : 'No shot lists yet'}
          body={view === 'archived' ? undefined : 'New shot list… makes the first one, from every scene and shot in this project.'}
        />
      ) : (
        <div className="rb-scene-lists-table" data-view={view === 'archived' ? 'archived' : 'lists'}>
          <Table
            head={(
              <Row>
                <Th width="var(--rb-scene-lists-col-mark)"><span className="sr-only">{view === 'archived' ? 'State' : 'Active'}</span></Th>
                <Th width="var(--rb-scene-lists-col-title)">Title</Th>
                <Th width="var(--rb-scene-lists-col-version)">Version</Th>
                <Th width="var(--rb-scene-lists-col-created)">Created</Th>
                <Th>Summary</Th>
                <Th width="var(--rb-scene-lists-col-acts)" align="right"><span className="sr-only">Actions</span></Th>
              </Row>
            )}
          >
            {rows.map(l => {
              const restore = view === 'archived' ? restoreFor(l) : null
              return (
                <Row key={l.id} interactive selected={selected === l.id}
                  onClick={() => setSelected(l.id)} onDoubleClick={() => open(l.id)}>
                  <Td>
                    {view === 'archived'
                      ? <StatusBadge status="archived" label={isWithdrawn?.(l) ? 'Withdrawn' : 'Archived'} />
                      : (l.id === activeId && <StatusBadge status="active" />)}
                  </Td>
                  <Td>{titleButton(l.id, l.title || 'Untitled')}</Td>
                  <Td className="rb-scene-lists-figure">{`v${Number(l.version) || 1}`}</Td>
                  <Td className="rb-scene-lists-figure">{showDate(l.created_at)}</Td>
                  <Td className="rb-scene-lists-summary" title={l.summary || undefined} data-empty={l.summary ? undefined : 'true'}>
                    {l.summary || '—'}
                  </Td>
                  <Td align="right">
                    {/* One button in the column in both views: the live
                        row's menu, the archived row's Restore (named for
                        its list, as every icon button here is). */}
                    {view === 'archived'
                      ? (restore && (
                        <IconButton size="sm" Icon={ArchiveRestore} title={`Restore “${label(l)}”`}
                          onClick={e => { e.stopPropagation(); restore() }} onDoubleClick={e => e.stopPropagation()} />
                      ))
                      : <MenuButton title={`Actions for ${label(l)}`} items={rowMenu(l)} minWidth={220} />}
                  </Td>
                </Row>
              )
            })}
          </Table>
        </div>
      )}

      {(showUnlisted || view === 'archived' || archived.length > 0) && (
        <div className="rb-scene-lists-more">
          {showUnlisted && (
            <button
              type="button"
              className="rb-scene-lists-entry"
              data-selected={selected === UNLISTED ? 'true' : undefined}
              aria-pressed={selected === UNLISTED}
              onClick={() => setSelected(UNLISTED)}
              onDoubleClick={() => open(UNLISTED)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); open(UNLISTED) } }}
            >
              <span className="rb-scene-lists-entry-name">{`Not in any list (${unlistedCount})`}</span>
              <span className="rb-scene-lists-entry-note">{`${plural(unlisted.scenes, 'scene')} · ${plural(unlisted.shots, 'shot')} no list holds`}</span>
            </button>
          )}
          {view === 'lists' && archived.length > 0 && (
            <button type="button" className="rb-scene-lists-entry" onClick={() => switchTo('archived')}>
              <span className="rb-scene-lists-entry-name">{`Archived… (${archived.length})`}</span>
              <span className="rb-scene-lists-entry-note">Archived and withdrawn lists</span>
            </button>
          )}
          {view === 'archived' && (
            <Button size="sm" variant="ghost" Icon={ArrowLeft} onClick={() => switchTo('lists')}>All shot lists</Button>
          )}
        </div>
      )}
    </Dialog>,
    document.body,
  )
}
