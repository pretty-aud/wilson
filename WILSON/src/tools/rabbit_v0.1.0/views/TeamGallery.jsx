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
// the name, the role (the member's title, with their @username in the cloud)
// and the seat, with the list's own controls in the foot: the seat select and
// the remove, far right, as in the row. Nothing here decides who may do what:
// the caller hands each card the same controls its row has (a read-only seat
// for a non-manager, no remove).
//
// The picture is a SIGNED read (avatarReads.js): never a bucket path in an
// <img src>, one signing call for the whole gallery, cached, and the pictures
// load lazily.
//
// Keyboard, as the Bins grid: the gallery is ONE tab stop — the current card;
// its controls leave the tab order until the card is entered (review round 1,
// R1-02: every card's select and remove were tab stops, so leaving a roster
// of fifty took a hundred Tabs). The arrows move by one card or by one row
// (the grid's real column count, read from its computed tracks), Home and
// End to the ends; Enter goes into the card (its first control), Escape comes
// back out to the card, and Tab past the card's last control leaves it.
// Inside a card neither the arrows nor a typed letter change a seat by
// themselves (R1-03, R2-02: on Windows a closed select takes ↑ ↓ and a letter
// as a new value, and a seat is a permission): open the seat with Alt+↓ or
// Space to choose. The gallery's keys stop at the gallery (R2-01: Home's
// hidden handler took them too). A card removed with the focus on it hands
// the focus to its neighbour (R2-04). There is no selection: the list has none.
// ============================================================

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Card } from '../../../ui/Card'
import { useAvatarImages } from '../../../components/TeamMembers/avatarReads'

/** Two initials from a name ("Mara Okonkwo" → "MO"), or "?". */
function initialsOf(name) {
  const s = (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
  return s || '?'
}

const CONTROLS = 'button, select, input, textarea, a[href]'
const SELECT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])
const controlsOf = (card) => [...card.querySelectorAll(CONTROLS)].filter((el) => !el.disabled)

/**
 * cards: [{ key, name, role, seatLabel, avatarUrl, avatarOwner, seat, actions }]
 *   avatarOwner  { workspaceId, userId }: whose picture the URL must be
 *   seat         the seat control or label, as the row draws it
 *   actions      the row's other controls (remove), or null
 */
export default function TeamGallery({ cards, label = 'Members' }) {
  const listRef = useRef(null)
  const [current, setCurrent] = useState(null)
  const [entered, setEntered] = useState(null)
  const { srcFor, onFailed } = useAvatarImages(cards.map((c) => ({ url: c.avatarUrl, owner: c.avatarOwner })))
  const keys = cards.map((c) => String(c.key))
  const active = keys.includes(current) ? current : (keys[0] ?? null)

  // The controls of every card but the entered one are out of the tab order.
  // Set on the DOM after every render: they are the caller's elements, and a
  // re-render may have made new ones.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    for (const card of list.querySelectorAll('[data-team-card]')) {
      const inside = card.dataset.teamCard === entered
      for (const el of card.querySelectorAll(CONTROLS)) el.tabIndex = inside ? 0 : -1
    }
  })

  const cardEl = useCallback((key) => (
    [...(listRef.current?.querySelectorAll('[data-team-card]') || [])].find((n) => n.dataset.teamCard === key) || null
  ), [])

  function onKeyDown(e) {
    const card = e.target?.closest?.('[data-team-card]')
    if (!card || !listRef.current?.contains(card)) return
    if (e.target !== card) {
      // Inside a card: Escape comes back out to it; neither the arrows nor a
      // typed letter change a closed seat select by themselves (R2-02: "r"
      // made a member a Reviewer, "m" a Manager) — Alt+↓ or Space opens it.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEntered(null); card.focus(); return }
      const typed = e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey
      if (e.target.tagName === 'SELECT' && !e.altKey && (SELECT_KEYS.has(e.key) || typed)) {
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }
    const i = keys.indexOf(card.dataset.teamCard)
    if (i < 0) return
    if (e.key === 'Enter') {
      const first = controlsOf(card)[0]
      // The gallery's keys stop here: nothing behind the page takes them too
      // (R2-01: Home's hidden handler opened D.O.G. on ↓ then Enter).
      if (first) { e.preventDefault(); e.stopPropagation(); setEntered(keys[i]); first.focus() }
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
    e.stopPropagation()
    const next = keys[Math.max(0, Math.min(keys.length - 1, to))]
    setCurrent(next)
    cardEl(next)?.focus()
  }

  // A card removed while it had the focus (its remove button, R2-04): the
  // focus goes to the card now in its place, or the last one, rather than
  // falling to the page.
  const lastIndexRef = useRef(0)
  const keysKey = keys.join('\n')
  useLayoutEffect(() => {
    if (current === null || keys.includes(current) || keys.length === 0) return
    const lost = !document.activeElement || document.activeElement === document.body
    if (!lost) return
    const next = keys[Math.min(lastIndexRef.current, keys.length - 1)]
    setCurrent(next)
    cardEl(next)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysKey])

  return (
    <div ref={listRef} className="rb-team-gallery" role="list" aria-label={label} onKeyDown={onKeyDown}>
      {cards.map((c) => {
        const key = String(c.key)
        const src = srcFor(c.avatarUrl, c.avatarOwner)
        return (
          <Card
            key={key}
            pad={false}
            className="rb-team-card"
            role="listitem"
            tabIndex={key === active ? 0 : -1}
            aria-label={[c.name, c.role, c.seatLabel].filter(Boolean).join(', ')}
            data-team-card={key}
            onFocus={(e) => {
              setCurrent(key)
              lastIndexRef.current = keys.indexOf(key)
              // Focus on one of its controls (a click, Enter): the card is entered.
              if (e.target !== e.currentTarget) setEntered(key)
            }}
            onBlur={(e) => {
              // Leaving the card altogether (Tab past its last control, a click
              // elsewhere): its controls leave the tab order again.
              if (!e.currentTarget.contains(e.relatedTarget)) setEntered((k) => (k === key ? null : k))
            }}
          >
            <div className="rb-team-card-media" aria-hidden="true">
              {src ? (
                <img
                  key={src}
                  className="rb-team-card-img"
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  onError={() => onFailed(c.avatarUrl, c.avatarOwner)}
                />
              ) : (
                <span className="rb-team-card-initials">{initialsOf(c.name)}</span>
              )}
            </div>
            <div className="rb-team-card-body">
              {/* Clipped to one line each; the whole of it on the hover. */}
              <span className="rb-team-card-name text-dense" title={c.name}>{c.name}</span>
              <span className="rb-team-card-role text-dense" title={c.role || undefined}>{c.role || '—'}</span>
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
