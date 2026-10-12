// ============================================================
// RABBIT — the Team tab's gallery (post-overhaul FX3)
// ============================================================
//
// Audrey, 2026-10-11: "for the team tab in rabbit. allow the user to see the
// items/members as a gallery. using the profile pic as a image for the cards
// in the gallery. allow the user to change views from table/list to gallery."
//
// One card per member, on the kit's Card and the Assets gallery's chrome
// (rabbitFiles.css `.rb-asset-gallery` / `.rb-asset-card-*`: the same grid
// gap, the same 144px picture well on the paper, the same body and foot), so
// the two galleries read as one kind of thing. On the card, in the order the
// list reads: the profile picture (or the initials tile where there is none),
// the name, the role (the member's title) and the seat, with the list's own
// controls in the foot: the seat select and the remove, far right, as in the
// row. Nothing here decides who may do what: the caller hands each card the
// same controls its row has (a read-only seat for a non-manager, no remove).
//
// The picture is a SIGNED read (avatarReads.js): never a bucket path in an
// <img src>, one signing call for the whole gallery, cached, and the pictures
// load lazily.
//
// Keyboard, as the Bins grid: the gallery is one tab stop (the current card);
// the arrows move by one card or by one row (the grid's real column count,
// read from its computed tracks), Home and End to the ends; Enter goes into
// the card (its first control), Escape comes back out to the card. There is
// no selection: the list has none.
// ============================================================

import { useCallback, useRef, useState } from 'react'
import { Card } from '../../../ui/Card'
import { focusableWithin } from '../../../ui/overlay'
import { useAvatarImages } from '../../../components/TeamMembers/avatarReads'

/** Two initials from a name ("Mara Okonkwo" → "MO"), or "?". */
function initialsOf(name) {
  const s = (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
  return s || '?'
}

/**
 * cards: [{ key, name, role, seatLabel, avatarUrl, seat, actions }]
 *   seat     the seat control or label, as the row draws it
 *   actions  the row's other controls (remove), or null
 */
export default function TeamGallery({ cards, label = 'Members' }) {
  const listRef = useRef(null)
  const [current, setCurrent] = useState(null)
  const { srcFor, markFailed } = useAvatarImages(cards.map((c) => c.avatarUrl))
  const keys = cards.map((c) => c.key)
  const active = keys.includes(current) ? current : (keys[0] ?? null)

  const focusCard = useCallback((key) => {
    setCurrent(key)
    const el = [...(listRef.current?.querySelectorAll('[data-team-card]') || [])].find((n) => n.dataset.teamCard === String(key))
    el?.focus()
  }, [])

  function onKeyDown(e) {
    const card = e.target?.closest?.('[data-team-card]')
    if (!card || !listRef.current?.contains(card)) return
    if (e.target !== card) {
      // Inside a card: Escape comes back out to it.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); card.focus() }
      return
    }
    const i = keys.indexOf(card.dataset.teamCard)
    if (i < 0) return
    if (e.key === 'Enter') {
      const first = focusableWithin(card)[0]
      if (first) { e.preventDefault(); first.focus() }
      return
    }
    // The grid's REAL column count, as the Bins grid reads it.
    const measured = listRef.current ? getComputedStyle(listRef.current).gridTemplateColumns.split(' ').filter(Boolean).length : 0
    const cols = Math.max(1, measured || 1)
    const to = {
      ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: keys.length - 1,
    }[e.key]
    if (to === undefined) return
    e.preventDefault()
    focusCard(keys[Math.max(0, Math.min(keys.length - 1, to))])
  }

  return (
    <div ref={listRef} className="rb-team-gallery" role="list" aria-label={label} onKeyDown={onKeyDown}>
      {cards.map((c) => {
        const src = srcFor(c.avatarUrl)
        return (
          <Card
            key={c.key}
            pad={false}
            className="rb-team-card"
            role="listitem"
            tabIndex={c.key === active ? 0 : -1}
            aria-label={[c.name, c.role, c.seatLabel].filter(Boolean).join(', ')}
            data-team-card={c.key}
            onFocus={(e) => { if (e.target === e.currentTarget) setCurrent(c.key) }}
          >
            <div className="rb-team-card-media" aria-hidden="true">
              {src ? (
                <img
                  className="rb-team-card-img"
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  onError={() => markFailed(c.avatarUrl)}
                />
              ) : (
                <span className="rb-team-card-initials">{initialsOf(c.name)}</span>
              )}
            </div>
            <div className="rb-team-card-body">
              <span className="rb-team-card-name text-dense">{c.name}</span>
              <span className="rb-team-card-role text-dense">{c.role || '—'}</span>
            </div>
            <div className="rb-team-card-foot">
              {c.seat}
              {c.actions}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
