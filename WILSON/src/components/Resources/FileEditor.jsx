// =============================================================================
// Resources/FileEditor.jsx — the editable half of the Files explorer's file
// window (post-overhaul S4a). DetailsPanel draws the eight facts and this
// under them.
//
// Audrey, 2026-09-29 (the E-note): "lets make sure the files page is not read
// only. i need to be able to view, download, and edit the files database. so
// edit notes, tags, etc." Her rulings, field by field:
//
//   NOTES  E2  "Description IS the note", shown multi-line: files.description
//              (0075, capped at 2000 by files_description_len_chk), or a
//              managed file's own `notes` (E11). Commits on blur; Escape
//              reverts (the kit's useEscapeRevert, inside TextArea).
//   CORE   E2  "Core = the existing flag": files.is_core_definer, the flag
//              Intake and D.O.G. read as the project's context. Hidden for a
//              managed file, with E11's reason in its place.
//   KIND   —   files.document_kind (0075) on the ProjectFilesTable's select
//              (KIND_OPTIONS), so the two lists cannot drift. Project files
//              only, like Core: nothing reads a managed file's kind.
//   TAGS   E3/E4  the nine, as toggles (kit Chip, aria-pressed), monochrome.
//              Finance is shown from is_financial and never set by hand;
//              Legal is a label that only people past the money gate may set
//              or clear, with the one-line "not restricted yet" hint.
//
// Laws of UX that shaped it (the laws-of-ux skill, applied, not cited):
//   · Law of Proximity — label 4px over its control, 16px between fields
//     (the kit Field's 4/16), so each pair reads as one thing and the four
//     read as four.
//   · Law of Common Region — the facts above and the fields below are two
//     regions split by one hairline, not two cards: what you READ and what
//     you CHANGE.
//   · Law of Similarity — a tag is the kit Chip in every state; on is the
//     one active treatment, a refused chip is the kit's disabled one with
//     its reason as the title (Session 29: denied controls are shown, greyed,
//     with the reason — never removed).
//   · Doherty Threshold — every change shows at once (the explorer's
//     in-flight overlay); a refusal comes back as a sentence above the
//     fields, and the value returns to what is stored.
// =============================================================================

import { useEffect, useId, useRef, useState } from 'react'
import { Banner, CellSelect, Chip, Switch, TextArea } from '../../ui'
import { KIND_OPTIONS } from '../../tools/rabbit_v0.1.0/components/ProjectFilesTable'
import {
  FILE_TAGS, DERIVED_TAG, LEGAL_HINT, displayTags, toggleTag, tagSettable,
} from '../../tools/rabbit_v0.1.0/fileTags'

/** files.description's CHECK (0075); a managed note is held to the same. */
export const NOTE_MAX = 2000

/** E2, in her words — the sentence under the Core switch. */
export const CORE_HINT = 'Files that give context about the project: the script, the treatment, storyboards, mood boards. Intake and D.O.G. read them.'

/** E11, verbatim — in place of Core (and Kind) on a managed file. */
export const MANAGED_CORE_REASON = 'Core files are project files; add it to the project to mark it core.'

export default function FileEditor({
  node,
  canWrite = false,
  writeReason = null,
  canSeeMoney = false,
  tagsSupported = false,
  saveError = '',
  onSave,
}) {
  const ids = { notes: useId(), kind: useId(), tags: useId() }
  const row = node?.row || {}
  const managed = node?.meta?.source === 'managed'
  const noteKey = managed ? 'notes' : 'description'
  const stored = String(row[noteKey] ?? '')
  // The draft is per FILE: keyed by the node so another file starts clean
  // (the parent remounts this with key={node.id}).
  const [draft, setDraft] = useState(stored)
  // 🚨 Review round 1, R1-UI-01 (HIGH, measured): pages stay mounted, so the
  // box outlives the note it was drawn with. A newer note (written on the
  // other host, a teammate's realtime edit, a save landing) never reached
  // it, and commitNote compared the draft with the STORED note — so focusing
  // and leaving the box wrote the stale draft over the newer note. Now:
  //   · while the box is not being edited it shows what is stored;
  //   · only what was TYPED during this focus is a change — leaving the box
  //     as it was when it took focus writes nothing, and shows the store;
  //   · a refused save puts the stored note back (R1-UI-02), unless the
  //     person is already typing in the box again.
  const storedRef = useRef(stored)
  storedRef.current = stored
  const editingRef = useRef(false)
  const atFocusRef = useRef(stored)
  useEffect(() => { if (!editingRef.current) setDraft(stored) }, [stored])

  const commitNote = () => {
    editingRef.current = false
    const next = draft.slice(0, NOTE_MAX)
    if (next === atFocusRef.current || next === storedRef.current) {
      setDraft(storedRef.current)
      return
    }
    Promise.resolve(onSave?.({ [noteKey]: next === '' ? null : next }))
      .then((saved) => { if (saved === false && !editingRef.current) setDraft(storedRef.current) })
      .catch(() => { if (!editingRef.current) setDraft(storedRef.current) })
  }

  const shown = new Set(displayTags(row))

  return (
    <div className="fx-edit" data-file-editor={node?.id}>
      {saveError && <Banner tone="danger" data-save-error>Could not save: {saveError}</Banner>}
      {!canWrite && writeReason && (
        <p className="fx-edit-reason" data-write-reason>{writeReason}</p>
      )}

      <div className="fx-edit-field">
        <label className="fx-edit-label" htmlFor={ids.notes}>Notes</label>
        <TextArea
          id={ids.notes}
          rows={4}
          value={draft}
          onChange={(v) => setDraft(String(v ?? '').slice(0, NOTE_MAX))}
          onFocus={(e) => { editingRef.current = true; atFocusRef.current = e.target.value }}
          onCommit={commitNote}
          // Escape reverts and blurs WITHOUT committing (the kit's
          // useEscapeRevert); the box is not being edited after it either,
          // and what it reverted to may be older than the store by now.
          onBlur={() => {
            editingRef.current = false
            setDraft((d) => (d === atFocusRef.current ? storedRef.current : d))
          }}
          maxLength={NOTE_MAX}
          placeholder={canWrite ? 'Add a note about this file' : 'No notes'}
          disabled={!canWrite}
          className="fx-edit-notes"
          data-file-notes
        />
      </div>

      {managed ? (
        <p className="fx-edit-hint" data-core-reason>{MANAGED_CORE_REASON}</p>
      ) : (
        <>
          <div className="fx-edit-field">
            <Switch
              checked={!!row.is_core_definer}
              onChange={(on) => onSave?.({ is_core_definer: on })}
              label="Core project file"
              disabled={!canWrite}
              title={canWrite ? undefined : writeReason || undefined}
              data-file-core
            />
            <span className="fx-edit-hint">{CORE_HINT}</span>
          </div>

          <div className="fx-edit-field">
            <label className="fx-edit-label" htmlFor={ids.kind}>Kind</label>
            <CellSelect
              id={ids.kind}
              value={row.document_kind || null}
              onChange={(v) => onSave?.({ document_kind: v })}
              placeholder="—"
              options={KIND_OPTIONS}
              disabled={!canWrite}
              data-file-kind
            />
          </div>
        </>
      )}

      {/* A group, not a <label>: a label around nine buttons would press the
          first one whenever its own text was clicked. */}
      <div className="fx-edit-field" role="group" aria-labelledby={ids.tags} data-file-tags>
        <span className="fx-edit-label" id={ids.tags}>Tags</span>
        {tagsSupported ? (
          <>
            <div className="fx-tags">
              {FILE_TAGS.map(({ id, label }) => {
                const gate = tagSettable(id, { canWrite, canSeeMoney })
                const on = shown.has(id)
                return (
                  <Chip
                    key={id}
                    active={on}
                    disabled={!gate.ok}
                    title={gate.ok ? (on ? `Remove ${label}` : `Tag as ${label}`) : gate.reason}
                    onClick={() => { if (gate.ok) onSave?.({ tags: toggleTag(row, id) }) }}
                    data-tag={id}
                    data-derived={id === DERIVED_TAG ? 'true' : undefined}
                  >
                    {label}
                  </Chip>
                )
              })}
            </div>
            <span className="fx-edit-hint" data-legal-hint>Legal is {LEGAL_HINT.charAt(0).toLowerCase() + LEGAL_HINT.slice(1)}</span>
          </>
        ) : (
          <span className="fx-edit-hint" data-tags-unavailable>
            Tags need a database update that has not reached this workspace yet.
          </span>
        )}
      </div>
    </div>
  )
}
