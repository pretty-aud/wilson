// ============================================================
// RABBIT — Save as… an edit's new version (post-overhaul S3c, step 5;
// D13, D14 — FX4)
// ============================================================
//
// FX4 (Audrey, 2026-10-12): "only when i press save as should it ask me to
// make a new edit version." The bar's Save edit writes the changes INTO the
// edit on screen and opens nothing; this dialog is Save as…'s, the one way to
// a new version. It makes the next edit of its list's ONE chain (D6) from the
// cut on screen — the unsaved changes, or a saved edit as it is — and the
// edit they began from stays as it was saved. S3b's shot-list form, at the
// form width, with what an edit needs:
//   Title     the edit's — or, for a new edit from the list, the name the
//             first-change question gave it
//   "Same title, next version"  (D14) on: that title at its next free
//             version; off: a title of the person's own, at ITS next free
//             version (v1 for a new one)
//   Summary   "What changed in this cut"
// The name it will take reads under the toggle ("Director's cut · v4"), and
// a refusal reads there before anything is sent (shotListModel's own
// validateVersionedTitle / assertUniqueEdit — the sentences the provider
// throws); a refusal from the backend lands in the Dialog's error slot,
// verbatim, and the form stays. Escape, ✕ and Cancel ask before what was
// typed here is dropped (the cut itself is never touched by closing).
// ============================================================

import { useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, Button, Field, Switch } from '../../../../ui'
import { validateVersionedTitle, assertUniqueEdit, nextEditVersion } from '../../state/shotListModel'
import ListConfirm from './ListConfirm'
import '../rabbitScenes.css'

/**
 * source    the cut on screen: the provider's draft, or a saved edit as it is
 *           ({ title, items, … })
 * from      the saved edit the cut began from, or null (a new edit from the
 *           list's order): it stays as it was saved
 * unsaved   the cut is a draft (its changes stay on screen if this closes)
 * list      its list
 * edits     every edit of the project (the next version, the clash)
 * label     formatShotListLabel
 * onSubmit  async ({ title, version, summary }) — throws a refusal
 * onClose
 */
export default function SaveEditDialog({ source, from = null, unsaved = false, list, edits, label, onSubmit, onClose }) {
  const formId = useId()
  const initial = useRef({ title: source.title, same: true, summary: '' }).current
  const [title, setTitle] = useState(initial.title)
  const [same, setSame] = useState(initial.same)
  const [summary, setSummary] = useState(initial.summary)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [askDiscard, setAskDiscard] = useState(false)

  const effectiveTitle = (same ? source.title : title) || ''
  const version = nextEditVersion(edits, list.id, effectiveTitle.trim())
  const problem = useMemo(() => {
    try {
      validateVersionedTitle({ title: effectiveTitle, version }, 'edit')
      assertUniqueEdit(edits, { shot_list_id: list.id, title: effectiveTitle.trim(), version })
      return null
    } catch (err) { return err.message }
  }, [effectiveTitle, version, edits, list.id])
  const dirty = title !== initial.title || same !== initial.same || summary !== initial.summary
  const n = (source.items || []).length
  const cut = `this cut, ${n} shot${n === 1 ? '' : 's'} in this order`

  async function submit(e) {
    e?.preventDefault?.()
    if (problem || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ title: effectiveTitle.trim(), version, summary: summary.trim() || null })
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  return createPortal(
    <>
      <Dialog
        width="form"
        className="wilson-dark-scroll"
        title={from ? 'Save as a new version' : 'Save as a new edit'}
        subtitle={from
          ? `A new version, from “${label(from)}”: ${cut}. “${label(from)}” stays as it was saved.`
          : `The next edit of “${label(list)}”: ${cut}. Every shot keeps its name.`}
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
            <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={busy}>{from ? 'Save new version' : 'Save new edit'}</Button>
          </>
        )}
      >
        <form id={formId} className="ui-field-stack" onSubmit={submit}>
          <Field label="Title">
            <input
              type="text"
              className="ui-input"
              value={effectiveTitle}
              disabled={same}
              autoFocus={!same}
              onFocus={e => e.currentTarget.select()}
              onChange={e => setTitle(e.target.value)}
              placeholder="Edit"
            />
          </Field>
          <div className="rb-scene-listform-version">
            <Switch
              checked={same}
              disabled={busy}
              label="Same title, next version"
              onChange={(on) => { setSame(on); if (on) setTitle(source.title) }}
            />
            <span className="rb-scene-listform-takes" data-state={problem ? 'refused' : 'ok'} aria-live="polite">
              {problem || `Will be “${label({ title: effectiveTitle.trim(), version })}”`}
            </span>
          </div>
          <Field label="Summary">
            <textarea
              className="ui-input"
              value={summary}
              rows={3}
              autoFocus={same}
              onChange={e => setSummary(e.target.value)}
              placeholder="What changed in this cut"
            />
          </Field>
        </form>
      </Dialog>
      {askDiscard && (
        <ListConfirm
          title="Discard what you typed?"
          confirmLabel="Discard"
          onCancel={() => setAskDiscard(false)}
          onConfirm={async () => { onClose() }}
        >
          {unsaved
            ? 'The changes stay on screen, not saved; only the title and summary typed here are dropped.'
            : 'Nothing is saved as a new version; only the title and summary typed here are dropped.'}
        </ListConfirm>
      )}
    </>,
    document.body,
  )
}
