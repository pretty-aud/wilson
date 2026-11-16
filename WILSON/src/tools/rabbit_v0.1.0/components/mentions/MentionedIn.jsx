// MO3 (0127): a thing's "Mentioned in" — what links to it, each from a thing the reader sees, and each opening its
// own place. Nothing is drawn while there are none, or on a database before 0127.
import { KIND_WORDS, linkedThingOpener } from '../../state/linkedThings'
import './mentions.css'

export default function MentionedIn({ links, title = 'Mentioned in' }) {
  const rows = (links || []).filter(l => l && l.target_id)
  if (!rows.length) return null
  return (
    <section className="rb-mentioned-in" aria-label={title}>
      <h4 className="rb-mentioned-in-head">{title}</h4>
      <ul className="rb-mentioned-in-list">
        {rows.map(l => {
          const open = linkedThingOpener(l)
          const name = l.name || 'Untitled'
          return (
            <li key={l.id} className="rb-mentioned-in-row">
              <span className="rb-mention-kind">{KIND_WORDS[l.kind] || l.kind}</span>
              {open ? (
                <button type="button" className="rb-mentioned-in-open" onClick={open} title={`Open ${name}`}>{name}</button>
              ) : <span className="rb-mention-name">{name}</span>}
              {l.label && <span className="rb-mentioned-in-label">{l.label}</span>}
              {l.origin === 'manual' && <span className="rb-mentioned-in-label">drawn by hand</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
