// MO3: the list `[[` and `#` open under a field (useMentionPicker). A listbox: the lit row is aria-selected, a click
// picks, the field keeps the keyboard. Placed under the field, never over the words being typed.
import { KIND_WORDS } from '../../state/linkedThings'
import './mentions.css'

export default function MentionPicker({ picker, onPick, id = 'mention-picker' }) {
  if (!picker?.open) return null
  const { mode, items, active, message, busy } = picker
  return (
    <div className="rb-mention-picker" data-mode={mode} aria-busy={busy ? 'true' : 'false'}>
      <div className="rb-mention-picker-head">
        {mode === 'link' ? 'Link to…' : 'Tag with…'}
        <span className="rb-mention-picker-hint">{mode === 'link' ? 'Enter picks · Esc closes' : '↓ then Enter picks · Esc closes'}</span>
      </div>
      {items.length > 0 && (
        <ul className="rb-mention-picker-list" role="listbox" id={id} aria-label={mode === 'link' ? 'Things to link to' : 'Tags'}>
          {items.map((item, i) => (
            <li
              key={`${item.kind || 'tag'}:${item.id}`}
              role="option"
              aria-selected={i === active ? 'true' : 'false'}
              className="rb-mention-picker-row"
              data-active={i === active ? 'true' : 'false'}
              onMouseDown={(e) => { e.preventDefault(); onPick?.(i) }}
              onMouseEnter={() => picker.setActive?.(i)}
            >
              {mode === 'link' ? (
                <>
                  <span className="rb-mention-kind">{KIND_WORDS[item.kind] || item.kind}</span>
                  <span className="rb-mention-name">{item.name || 'Untitled'}</span>
                </>
              ) : (
                <>
                  <span className="rb-mention-kind">{item.tier === 'company' ? 'Company' : 'Yours'}</span>
                  <span className="rb-mention-name">{item.label}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {message && <div className="rb-mention-picker-note" role="status">{message}</div>}
    </div>
  )
}
