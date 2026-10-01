// ============================================================
// RABBIT — New shot list, Save as…, Edit details (post-overhaul S3b, step 5)
// ============================================================
//
// One kit Dialog at the form width for the three. Its fields, in order:
//   Title     prefilled with the list on screen's (selected, so typing
//             replaces it)
//   "Same title, next version"  (D14) — on, the title is the list's and the
//             version the next free one (nextShotListVersion); off, a title
//             of the person's own at v1. On by default for Save as…; never
//             shown for Edit details, which does not re-version.
//   Summary   "What this shot list is"
//   Start from (New only): the list on screen — the SAME scenes and shots,
//             linked, not copied (D1 + D3) — every scene and shot in the
//             project (`fromAll`, the default when there is no list on
//             screen to start from), or empty. Save as… is always the list
//             on screen.
// The name the list will take reads under the toggle ("Shoot · v2"), and a
// refusal reads there before anything is sent: shotListModel's own
// validateVersionedTitle / assertUniqueShotList, the sentences the provider
// throws. A refusal from the backend lands in the Dialog's error slot,
// verbatim, and the form stays.
//
// Plain fields in the kit's well (`ui-input`), as the lane's popups and
// filter strip use them: the kit Input / TextArea revert on Escape, which in
// a form would throw away what was typed without a word. Instead Escape, ✕
// and Cancel ASK before a changed form is dropped (the kit Dialog's
// onBeforeClose — D21's rule for the popups, kept here too); a press on the
// backdrop does nothing, the kit form's default, so a stray click loses
// nothing (review round 1, R1-11: this said the backdrop asked).
// ============================================================

import { useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, Button, Field, Switch } from '../../../../ui'
import { validateVersionedTitle, assertUniqueShotList, nextShotListVersion } from '../../state/shotListModel'
import ListConfirm from './ListConfirm'
import '../rabbitScenes.css'

const TITLES = { new: 'New shot list', saveAs: 'Save as a new version', details: 'Edit details' }
const VERBS = { new: 'Create shot list', saveAs: 'Save new version', details: 'Save details' }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * mode        'new' | 'saveAs' | 'details'
 * source      the list on screen (new, saveAs) or the list being edited (details); may be null for new
 * lists       every list of the project (for the next version and the clash)
 * counts      { screen: { scenes, shots }, all: { scenes, shots } }
 * defaultFrom 'screen' | 'all' | 'empty' (new only)
 * label       formatShotListLabel
 * onSubmit    async ({ title, version, summary, from }) — throws a refusal
 * onClose
 */
export default function ShotListForm({ mode, source, lists, counts, defaultFrom, label, onSubmit, onClose }) {
  const formId = useId()
  const initial = useRef({
    title: source?.title || (mode === 'new' && !(lists || []).some(l => !l.archived_at) ? 'Shot list 1' : ''),
    same: mode === 'saveAs',
    summary: mode === 'new' ? '' : (source?.summary || ''),
    from: mode === 'saveAs' ? 'screen' : (defaultFrom || 'empty'),
  }).current
  const [title, setTitle] = useState(initial.title)
  const [same, setSame] = useState(initial.same)
  const [summary, setSummary] = useState(initial.summary)
  const [from, setFrom] = useState(initial.from)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [askDiscard, setAskDiscard] = useState(false)

  // With the toggle on, the title is the list's own.
  const effectiveTitle = (same && source ? source.title : title) || ''
  const version = mode === 'details'
    ? (Number(source?.version) || 1)
    : (same && source ? nextShotListVersion(lists, source.title) : 1)
  const problem = useMemo(() => {
    try {
      validateVersionedTitle({ title: effectiveTitle, version })
      assertUniqueShotList(lists, { id: mode === 'details' ? source?.id : undefined, title: effectiveTitle, version })
      return null
    } catch (err) { return err.message }
  }, [effectiveTitle, version, lists, mode, source])
  const dirty = title !== initial.title || same !== initial.same || summary !== initial.summary || from !== initial.from
  // A New shot list opens on the list's own title at v1, which is taken —
  // or, with no list on screen ("Not in any list"), on no title at all: a
  // form nobody has touched yet says what to do, in the second ink, rather
  // than greeting the person with a refusal (review round 1, R1-14: the
  // second case opened on "A shot list needs a title."); once they have
  // changed the title or the toggle, the refusal reads in the model's own
  // words.
  const touched = title !== initial.title || same !== initial.same
  const nextLabel = source ? label({ title: source.title, version: nextShotListVersion(lists, source.title) }) : ''
  const untouchedHint = problem && !touched && mode === 'new'
    ? (source && !same ? `Type a new title, or turn on “Same title, next version” for “${nextLabel}”.` : 'Type a title for the new shot list.')
    : null
  const takesLine = !problem ? `Will be “${label({ title: effectiveTitle.trim(), version })}”` : (untouchedHint || problem)
  const takesState = !problem ? 'ok' : (untouchedHint ? 'hint' : 'refused')

  async function submit(e) {
    e?.preventDefault?.()
    if (problem || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ title: effectiveTitle.trim(), version, summary: summary.trim() || null, from })
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  const screen = counts?.screen || { scenes: 0, shots: 0 }
  const all = counts?.all || { scenes: 0, shots: 0 }
  const sourceLabel = source ? label(source) : ''

  return createPortal(
    <>
      <Dialog
        width="form"
        className="wilson-dark-scroll"
        title={TITLES[mode]}
        subtitle={mode === 'saveAs'
          ? `A new list from “${sourceLabel}”: the same scenes and shots, linked — not copied.`
          : mode === 'details' ? `Of “${sourceLabel}”. Its scenes and shots are not changed.` : null}
        busy={busy}
        error={error}
        onBeforeClose={() => {
          if (!dirty || busy) return true
          setAskDiscard(true)
          return false
        }}
        onClose={onClose}
        footer={(
          <>
            <Button disabled={busy} onClick={() => { if (!dirty) onClose(); else setAskDiscard(true) }}>Cancel</Button>
            <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={busy}>{VERBS[mode]}</Button>
          </>
        )}
      >
        <form id={formId} className="ui-field-stack" onSubmit={submit}>
          <Field label="Title">
            <input
              type="text"
              className="ui-input"
              value={effectiveTitle}
              disabled={same && !!source}
              autoFocus={!(same && source)}
              onFocus={e => e.currentTarget.select()}
              onChange={e => setTitle(e.target.value)}
              placeholder="Shot list"
            />
          </Field>

          {mode !== 'details' && (
            <div className="rb-scene-listform-version">
              <Switch
                checked={same}
                disabled={!source || busy}
                label="Same title, next version"
                onChange={(on) => { setSame(on); if (on && source) setTitle(source.title) }}
              />
              {/* Polite, not an alert: it changes with every key. */}
              <span className="rb-scene-listform-takes" data-state={takesState === 'refused' ? 'refused' : takesState === 'hint' ? 'hint' : 'ok'} aria-live="polite">
                {takesLine}
              </span>
            </div>
          )}
          {mode === 'details' && problem && (
            <span className="rb-scene-listform-takes" data-state="refused" aria-live="polite">{problem}</span>
          )}

          <Field label="Summary">
            <textarea
              className="ui-input"
              value={summary}
              rows={3}
              onChange={e => setSummary(e.target.value)}
              placeholder="What this shot list is"
            />
          </Field>

          {mode === 'new' && (
            <fieldset className="rb-scene-listform-from">
              <legend className="ui-field-label">Start from</legend>
              <label className="rb-scene-listform-option" data-disabled={source ? undefined : 'true'}>
                <input type="radio" name={`${formId}-from`} value="screen" checked={from === 'screen'} disabled={!source} onChange={() => setFrom('screen')} />
                <span className="rb-scene-listform-option-words">
                  <span className="rb-scene-listform-option-name">The list on screen</span>
                  <span className="rb-scene-listform-option-note">
                    {source ? `“${sourceLabel}”: ${plural(screen.scenes, 'scene')} and ${plural(screen.shots, 'shot')}, linked — not copied` : 'No list is on screen'}
                  </span>
                </span>
              </label>
              <label className="rb-scene-listform-option">
                <input type="radio" name={`${formId}-from`} value="all" checked={from === 'all'} onChange={() => setFrom('all')} />
                <span className="rb-scene-listform-option-words">
                  <span className="rb-scene-listform-option-name">Every scene and shot in this project</span>
                  <span className="rb-scene-listform-option-note">{`${plural(all.scenes, 'scene')} and ${plural(all.shots, 'shot')}, in number order, linked — not copied`}</span>
                </span>
              </label>
              <label className="rb-scene-listform-option">
                <input type="radio" name={`${formId}-from`} value="empty" checked={from === 'empty'} onChange={() => setFrom('empty')} />
                <span className="rb-scene-listform-option-words">
                  <span className="rb-scene-listform-option-name">Empty</span>
                  <span className="rb-scene-listform-option-note">Add scenes and shots to it afterwards</span>
                </span>
              </label>
              <p className="rb-scene-listform-shared">
                A scene or shot is one row in every list that holds it: rename it, or change its status, in one list and it changes in all of them. A list holds only which scenes and shots it has, and their order.
              </p>
            </fieldset>
          )}
        </form>
      </Dialog>
      {askDiscard && (
        <ListConfirm
          title={mode === 'details' ? 'Discard your changes?' : 'Discard this new shot list?'}
          confirmLabel="Discard"
          onCancel={() => setAskDiscard(false)}
          onConfirm={async () => { onClose() }}
        >
          {mode === 'details' ? 'Nothing you changed here is saved.' : 'Nothing has been made yet; what you typed here is dropped.'}
        </ListConfirm>
      )}
    </>,
    document.body,
  )
}
