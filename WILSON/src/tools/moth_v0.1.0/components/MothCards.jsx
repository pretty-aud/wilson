// MothCards.jsx — MO2: the folder cards, bottom left of the HUD (the brief §3.3, her rulings of 2026-11-01).
// Select a folder and a small scrollable card shows what is in it; pin it and it
// stays while you move about, up to five at once, each scrolling on its own. A sixth is refused with a sentence.
// Files drag between cards, and from a card onto the graph. Pinned cards are never saved with a view: instead a
// small icon opens the folders opened last, and nothing shows until it is pressed.
import { useEffect, useMemo, useState } from 'react'
import { Clock, Pin, PinOff, X } from 'lucide-react'
import { IconButton } from '../../../ui'
import { nodeId } from '../engine/model.js'

export const MAX_PINNED = 5
export const SIXTH_SENTENCE = 'Five cards at most. Unpin one to pin this.'
const CONTAINER = new Set(['project', 'folder', 'phase', 'scene'])
const FILE_DRAG = 'application/x-wilson-moth-file'

function Card({ id, index, children, pinned, onPin, onClose, onSelect, onDropFile, onDragFile }) {
  const row = index.rows.get(id)
  const [over, setOver] = useState(false)
  if (!row) return null
  const kids = (children.get(id) || []).map((k) => index.rows.get(k)).filter(Boolean)
    .sort((a, b) => Number(b.kind !== 'file') - Number(a.kind !== 'file') || String(a.label).localeCompare(String(b.label)))
  return (
    <section
      className={`moth-card${over ? ' is-over' : ''}`}
      aria-label={row.label || 'Folder'}
      data-moth-card={pinned ? 'pinned' : 'open'}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes(FILE_DRAG)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const fid = e.dataTransfer?.getData(FILE_DRAG); if (fid) { e.preventDefault(); onDropFile(fid, id) } }}
    >
      <header className="moth-card-head">
        <span className="moth-card-title">{row.label || '(no name)'}</span>
        <IconButton size="sm" Icon={pinned ? PinOff : Pin} title={pinned ? 'Unpin this card' : 'Pin this card'} onClick={onPin} />
        {onClose && <IconButton size="sm" Icon={X} title="Close this card" onClick={onClose} />}
      </header>
      <ul className="moth-card-rows">
        {kids.length === 0 && <li className="moth-quiet">Nothing here you can see.</li>}
        {kids.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              className="moth-link"
              draggable={k.kind === 'file'}
              onDragStart={(e) => { if (k.kind === 'file') { e.dataTransfer.setData(FILE_DRAG, k.rowId); e.dataTransfer.effectAllowed = 'move'; onDragFile?.(k.rowId) } }}
              onClick={() => onSelect(k.id)}
            >
              {k.label || '(no name)'}{CONTAINER.has(k.kind) ? ' ›' : ''}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function MothCards({ selectedId, index, recent, onSelect, onOpenCard, onDropFile, onNote }) {
  const [pinned, setPinned] = useState([])
  const [shut, setShut] = useState(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const [opened, setOpened] = useState(null)
  const children = useMemo(() => {
    const out = new Map()
    for (const [id, p] of index.parent) {
      if (!out.has(p)) out.set(p, [])
      out.get(p).push(id)
    }
    return out
  }, [index])
  // A new selection is followed afresh: a card shut, or one picked from the recent list, was for the last one.
  useEffect(() => { setShut(null); setOpened(null) }, [selectedId])
  const selectedRow = selectedId ? index.rows.get(selectedId) : null
  // The open card: a folder selected (the smallest level, a folder with its files; the brief §3.3), or one picked
  // from the recent list, unless it is pinned already or shut.
  const openId = opened && index.rows.has(opened) ? opened
    : selectedRow && selectedRow.kind === 'folder' && selectedId !== shut ? selectedId : null
  const live = pinned.filter((id) => index.rows.has(id))
  // Every folder whose card is shown is one of the folders opened last (the recent icon), not only a pinned one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (openId) onOpenCard?.(openId) }, [openId])
  const pin = (id) => {
    if (live.includes(id)) { setPinned(live.filter((x) => x !== id)); return }
    if (live.length >= MAX_PINNED) { onNote?.(SIXTH_SENTENCE); return }
    setPinned([...live, id])
    setOpened(null)
    onOpenCard?.(id)
  }
  // The folders opened last session, as Moth shows them now (a hidden or gone one is simply absent).
  const recentRows = (recent || []).map((r) => nodeId(r.k, r.id)).filter((id) => index.rows.has(id))

  return (
    <div className="moth-cards" data-moth-cards>
      <div className="moth-cards-strip">
      {live.map((id) => (
        <Card key={id} id={id} index={index} children={children} pinned onPin={() => pin(id)} onSelect={onSelect} onDropFile={onDropFile} />
      ))}
      {openId && !live.includes(openId) && (
        <Card id={openId} index={index} children={children} pinned={false} onPin={() => pin(openId)}
          onClose={() => { setOpened(null); setShut(openId) }} onSelect={onSelect} onDropFile={onDropFile} />
      )}
      </div>
      <div className="moth-recent">
        <IconButton size="sm" Icon={Clock} title="Folders opened last" onClick={() => setRecentOpen((v) => !v)} aria-expanded={recentOpen} data-moth-recent />
        {recentOpen && (
          <ul className="moth-recent-list" data-moth-recent-list>
            {recentRows.length === 0 && <li className="moth-quiet">None yet.</li>}
            {recentRows.map((id) => (
              <li key={id}>
                <button type="button" className="moth-link" onClick={() => { setRecentOpen(false); setShut(null); setOpened(id) }}>
                  {index.rows.get(id)?.label || '(no name)'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
