// MO3 (0127): a text with typed links in it, as its reader may see it. A token whose link the reader sees is drawn
// as a link to its thing, named by the author's words; any other token is its words alone, plain, with nothing that
// says a link was there (a hidden thing, a deleted one and a copied key read the same). Plain text stays plain.
import { splitMentions } from '../../state/mentionTokens'
import { linkedThingOpener } from '../../state/linkedThings'
import './mentions.css'

// `interactive` false draws a seen link's words as a link without making them one, for text inside a control that
// is itself a button (the field's read view, which opens the editor): its links are listed beside it instead.
export default function MentionText({ text, links, className, onOpen, interactive = true }) {
  const parts = splitMentions(text || '')
  if (!parts.length) return null
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (!p.key) return <span key={i}>{p.text}</span>
        const link = links?.get?.(p.key)
        const open = link ? (onOpen ? () => onOpen(link) : linkedThingOpener(link)) : null
        if (!link || !open) return <span key={i}>{p.words}</span>
        if (!interactive) return <span key={i} className="rb-mention-link">{p.words}</span>
        return (
          <a
            key={i}
            href="#"
            className="rb-mention-link"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); open() }}
            title={link.name ? `Open ${link.name}` : 'Open'}
          >
            {p.words}
          </a>
        )
      })}
    </span>
  )
}
