// MO3 (0126, 0127): a R.A.B.B.I.T. textarea that takes `[[` (a link to a thing the writer sees) and `#` (a tag on the
// thing being written). Everything else is the plain textarea it was: the same value, onChange, onBlur and keys. A
// pick puts the token where the asking began and the caret after it; a tag is put on `target` at once and leaves
// nothing in the text. The list keeps the field's focus: a click on a row does not blur it.
import { useCallback, useRef } from 'react'
import { useMentionPicker } from './useMentionPicker'
import MentionPicker from './MentionPicker'

export default function MentionTextArea({ value, onChange, onKeyDown, getAdapter, target, onTagged, ...rest }) {
  const ref = useRef(null)
  const picker = useMentionPicker({ getAdapter, target, onTagged })

  const ask = useCallback((el) => {
    if (!el) return
    picker.update(String(el.value).slice(0, el.selectionStart ?? 0))
  }, [picker])

  const doPick = useCallback(async (index) => {
    const el = ref.current
    if (!el) return
    const caret = el.selectionStart ?? String(value || '').length
    const res = await picker.pick(index)
    if (!res) return
    const cur = String(el.value)
    const next = cur.slice(0, res.start) + res.text + cur.slice(caret)
    onChange?.(next)
    const at = res.start + res.text.length
    requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(at, at) } catch { /* gone */ } })
  }, [onChange, picker, value])

  return (
    <div className="rb-mention-field">
      <textarea
        ref={ref}
        value={value}
        {...rest}
        onChange={(e) => { onChange?.(e.target.value); ask(e.target) }}
        onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) ask(e.target) }}
        onClick={(e) => ask(e.target)}
        onKeyDown={(e) => {
          const took = picker.keyDown(e)
          if (took === 'pick') { doPick(picker.active); return }
          if (took === 'handled') return
          onKeyDown?.(e)
        }}
        aria-autocomplete="list"
        aria-expanded={picker.open ? 'true' : 'false'}
      />
      <MentionPicker picker={picker} onPick={doPick} />
    </div>
  )
}
