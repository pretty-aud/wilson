// ============================================================
// RABBIT — the custom views' *changed for now* bar (VW1d, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.4 (as VW1d's step 0 review corrected
// it): the kit Banner, its `info` tone (`danger` for a refusal), without its
// own live role (VW1-KR-4: its words go to the table's one polite live
// region), in the flow after the Filter strip, directly above the table,
// present only while the view on screen has unsaved edits (her Q3c, Q-A3) —
// with news about them when there is news (Q3d). Its rows are useTableView's
// bar, derived on render (viewScreenModel.barStateOf).
//
// Her answers: Q3a (Save into this view for everyone, Save as new view,
// Reset; All only Save as new view; reviewers Reset only), Q-G3 ("go with
// your pick": Save over a teammate's newer save asks first), Q3d (Reset takes
// theirs). *Save* is the bar's one primary button (Von Restorff); saving
// moves the keyboard to the Views button (§4.9).

import { useEffect, useRef, useState } from 'react'
import { Banner, Button } from '../../../../ui'
import { copyName } from './viewScreenModel'
import './tableViews.css'

/**
 * The bar. `tv` the table's useTableView; `ask` the root's question; `announce`
 * the table's live region; `focusViews` puts the keyboard on the Views button.
 */
export function ViewBar({ tv, ask, announce = () => {}, focusViews = () => {} }) {
  const bar = tv.bar
  const [naming, setNaming] = useState(null) // { text, error }
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const words = bar?.words || ''
  // The bar's words, said once each time they change (the Banner says nothing itself).
  useEffect(() => { if (words) announce(words) }, [words]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (naming && inputRef.current) { inputRef.current.focus(); inputRef.current.select() } }, [naming === null]) // eslint-disable-line react-hooks/exhaustive-deps
  // The bar goes when its change does: so does a name being typed for it.
  useEffect(() => { if (!bar && naming) setNaming(null) }, [bar, naming])
  if (!bar) return null

  async function save() {
    if (busy) return
    let over = false
    if (bar.asks) {
      const yes = await ask(overQuestion(tv))
      if (!yes) return
      over = true
    }
    setBusy(true)
    try {
      const status = await tv.save({ over })
      if (status === 'saved') {
        announce(`${tv.name} saved`)
        focusViews()
      }
    } finally {
      setBusy(false)
    }
  }
  async function saveAsNew() {
    if (!naming || busy) return
    setBusy(true)
    try {
      const made = await tv.saveAsNew(naming.text)
      setNaming(null)
      announce(`${made.name} saved for everyone`)
      focusViews()
    } catch (err) {
      setNaming(n => (n ? { ...n, error: err?.message || String(err) } : n))
    } finally {
      setBusy(false)
    }
  }
  function reset() {
    tv.reset()
    announce(tv.deleted ? 'Back to All' : `${tv.name} as saved`)
    focusViews()
  }

  const has = (a) => bar.actions.includes(a)
  const reason = (a) => bar.disabled?.[a] || null
  const action = naming ? (
    <span className="rb-tv-bar-actions">
      <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>Cancel</Button>
      <Button size="sm" variant="primary" loading={busy} onClick={saveAsNew}>Save view</Button>
    </span>
  ) : (
    <span className="rb-tv-bar-actions">
      {has('retry') && <Button size="sm" variant="primary" loading={busy} onClick={save}>Try again</Button>}
      {has('reset') && <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>}
      {has('saveAsNew') && (
        <Button size="sm" disabled={!!reason('saveAsNew')} title={reason('saveAsNew') || undefined}
          onClick={() => setNaming({ text: copyName(tv.name), error: null })}>
          Save as new view
        </Button>
      )}
      {has('save') && (
        <Button size="sm" variant="primary" loading={busy} disabled={!!reason('save')} title={reason('save') || undefined} onClick={save}>
          Save
        </Button>
      )}
    </span>
  )
  return (
    <Banner tone={bar.tone} live={false} className="rb-tv-bar" action={action}>
      {naming ? (
        <span className="rb-tv-field rb-tv-bar-field">
          <input ref={inputRef} type="text" value={naming.text} aria-label="View name" placeholder="View name"
            className="ui-input rb-tv-input" data-size="sm"
            aria-invalid={naming.error ? 'true' : undefined}
            onChange={e => setNaming({ text: e.target.value, error: null })}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); saveAsNew() }
              if (e.key === 'Escape') { e.preventDefault(); setNaming(null) }
            }} />
          {naming.error && <span className="rb-tv-field-error" role="alert">{naming.error}</span>}
        </span>
      ) : words}
    </Banner>
  )
}

/** Q-G3's question: who saved the view meanwhile, in the bar's own words. */
function overQuestion(tv) {
  const by = tv.changedBy
  const lead = by === 'me'
    ? `You saved ${tv.name} in another window after you began these changes.`
    : by === 'computer'
      ? `${tv.name} was saved on another computer after you began these changes.`
      : `${by || 'Someone'} saved ${tv.name} after you began these changes.`
  return {
    title: `Save over the newer ${tv.name}?`,
    body: <p className="rb-tv-ask">{lead} Saving puts yours in its place, for everyone on the project.</p>,
    confirm: 'Save my changes',
  }
}
