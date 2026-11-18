// =============================================================================
// useInlineText — words that become a field on a click, and back (post-overhaul
// F10, rabbit A6). Eight copies of this lived in R.A.B.B.I.T.'s views (the
// tables' cells, the cards, the windows' name fields, the task window's
// title) and had drifted: six trimmed nothing, three let Escape reach the
// Dialog around them, one put focus back where it had been and seven dropped
// it to <body> (OUTSTANDING P1-06). The behaviour is here once.
//
// THE BEHAVIOUR, the same for every caller:
//  · A click on the words opens the field on the saved words and focuses it.
//  · Enter and blur commit the TRIMMED draft, once per edit, and only when
//    something was typed and the trimmed words differ from the saved ones (a
//    blur after Enter does not write again; words saved with an outer space,
//    opened and left, write nothing: review round 1, 1A-05).
//  · Enter is marked handled: the words take focus back inside the same key
//    press, and in Chromium the press's keypress would then land on them — a
//    button, whose Enter is a click — and open the editor again (1A-01,
//    measured in Chromium; jsdom sends no keypress).
//  · Escape reverts and closes. It stops the key and marks it handled, as the
//    kit Input's Escape does (useEscapeRevert): a kit Dialog around the field
//    stays open on the first press (W2). The key is then handed to
//    `onKeyDown`, so a caller keeps whatever else Escape meant there.
//  · When the edit closes and focus has nowhere to go — after Enter and
//    Escape, and after a blur that takes it nowhere (the window loses focus,
//    a click on nothing; inside a kit Dialog a click on nothing focuses the
//    Dialog's own surface, which holds the field, and counts as nothing:
//    review round 2, 2A-01) — focus goes back to the words (useFocusBack;
//    P1-06). After a blur, without a scroll: a rename that moved its row under
//    a sort scrolled the table to it between the press and the release, and
//    the click was lost (2A-02, measured in Chromium). A blur on its way to a
//    control (a Tab, a click into another field) lets it go there (1A-02 /
//    1B-01, measured in Chromium).
//  · The draft follows the saved words while the field is closed, or open and
//    untouched (useSavedDraft, D21's R1-06): a teammate's change shows in a
//    field nobody has typed in; a typed draft stays.
//  · `readOnly`: the words alone, inert — no click, no field, no tab stop.
//
// THE MARKUP is the caller's when it hands its own elements: `words` (a
// `<button>`, a tab stop, or a `<span>`, which gets tabIndex -1 so focus can
// come back to it without adding a tab stop — the Scenes tables' cells, where
// a tab stop per row was ruled out, C1), `field` (the `<input>`) and `still`
// (the read-only words). Each is drawn as given — its classes, its `data-*`,
// its title and names — with the behaviour added: the click, the ref, the
// field's value and keys. Each of today's eight editors has a look of its own
// (their cursors, hovers and edges differ, measured in F10), and the lanes'
// sheet guards read each element's classes and `data-*` from the view's own
// source, so the elements stay written there. With none handed, the kit's
// own look: `.ui-inline-text` (index.css) and the kit's small well.
//
// The field is a native `<input>`, not the kit Input, whose own Enter and
// Escape would break the draft (B3d trap 3).
//
// A HOOK THAT DRAWS, not a component (as useAsk draws its question): a view
// keeps its own name for its editor (its suites pin the names) and that
// component calls this, so each editor is still one component. A component
// wrapped around a component put a second render on every row of every table
// — measured by F4's render counts: 574 renders for a task renamed on the
// Assets tab became 589, one more for each row's editor.
// =============================================================================

import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'

/**
 * A draft of one saved text (D21; review round 1, R1-06). The saved words
 * replace the draft while its editor is closed — and while it is open but
 * still holds the words it opened on, so a change from elsewhere (a teammate,
 * a re-read, Ctrl+Z) shows in an editor nobody has typed in, which neither
 * reads as changed nor writes the old words back on Save. A draft someone HAS
 * typed in stays put. The basis is read before the update is queued: React
 * may run the updater after this effect has moved the ref on.
 */
export function useSavedDraft(saved, editing) {
  const [draft, setDraft] = useState(saved)
  const basisRef = useRef(saved)
  useEffect(() => {
    const basis = basisRef.current
    basisRef.current = saved
    setDraft(d => (!editing || d === basis ? saved : d))
  }, [saved, editing])
  return [draft, setDraft]
}

/**
 * An editor whose words at rest can take focus gives focus back to them when
 * its edit closes (review round two, R2-05; P1-06): the field that had focus
 * goes with the edit, and focus fell to <body>, so the next Tab started again
 * from the page's (or the Dialog's) first control. Only when focus HAS fallen
 * there — after Escape, Enter, Save or Cancel, whose control is the one that
 * went, and after a blur that takes it nowhere.
 *
 * 🚨 `leaving`: an editor that closes on a blur says where focus is going —
 * 'away' (to a control: the blur's `relatedTarget`) or 'nowhere' (none, or an
 * element that HOLDS the field: a kit Dialog's surface, which a click on
 * nothing in the window focuses). React renders a blur's close, and runs this
 * effect, INSIDE the browser's focus change: `activeElement` is <body> and the
 * control is not focused yet, and a `focus()` here makes Chromium drop the
 * move — after 'away', the Tab or the click would land on the words (F10
 * review round 1, 1A-02 / 1B-01). After 'nowhere' the words take it without a
 * scroll (review round 2, 2A-01, 2A-02; all measured in Chromium, which jsdom
 * cannot show: it moves focus before the effect). Returns the ref for the words.
 */
export function useFocusBack(editing, leaving = null) {
  const wordsRef = useRef(null)
  const wasEditing = useRef(editing)
  useEffect(() => {
    const closed = wasEditing.current && !editing
    wasEditing.current = editing
    if (!closed) return
    const how = leaving?.current || null
    if (leaving) leaving.current = null
    if (how === 'away') return
    const active = document.activeElement
    if (!active || active === document.body) wordsRef.current?.focus(how === 'nowhere' ? { preventScroll: true } : undefined)
  }, [editing, leaving])
  return wordsRef
}

/** The editor, drawn: call it from the component that stands for it (see above). */
export function useInlineText({
  value = '',
  onCommit,
  label,
  placeholder = '—',
  readOnly = false,
  // The words at rest from the saved value (R.A.B.B.I.T.'s mention tokens
  // read as their words); the field always edits the raw value.
  display = null,
  // The read-only words when there are none; the placeholder by default.
  staticEmpty,
  // The words' and the field's clicks stop there (a row that opens on a click).
  stopClick = false,
  words = null,
  field = null,
  still = null,
  onKeyDown,
}) {
  const saved = value ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useSavedDraft(saved, editing)
  // Where a blur that closes the edit sends focus: 'away' or 'nowhere' (useFocusBack).
  const leavingRef = useRef(null)
  const wordsRef = useFocusBack(editing, leavingRef)
  const inputRef = useRef(null)
  // One commit per edit: Enter commits and closes, and the blur that may
  // follow as the field goes must not write again.
  const doneRef = useRef(false)
  // The field takes focus when it opens, and again when it comes back after
  // `readOnly` came and went with the edit open (it returned unfocused:
  // review round 2, 2A-03; the copies' autoFocus did this).
  useEffect(() => {
    if (!editing || readOnly) return
    doneRef.current = false
    leavingRef.current = null
    inputRef.current?.focus()
  }, [editing, readOnly])

  const shown = (display ? display(saved) : saved) || null

  if (readOnly) {
    const content = shown || (staticEmpty ?? placeholder)
    if (isValidElement(still)) return still.props.children != null ? still : cloneElement(still, undefined, content)
    return (
      <span className="ui-inline-text" data-static="true" data-empty={saved ? undefined : 'true'}>
        {content}
      </span>
    )
  }

  function commit() {
    if (doneRef.current) return
    doneRef.current = true
    // Closed first, as the copies did: a writer that throws must not leave
    // the field open and deaf to Enter and blur (review round 2, 2A-04).
    setEditing(false)
    const next = draft.trim()
    if (draft !== saved && next !== saved) onCommit?.(next)
  }
  function revert() {
    doneRef.current = true
    setDraft(saved)
    setEditing(false)
  }

  if (editing) {
    const behaviour = {
      ref: inputRef,
      type: 'text',
      value: draft,
      onChange: e => setDraft(e.target.value),
      onBlur: e => {
        if (!doneRef.current) {
          const to = e.relatedTarget
          leavingRef.current = to && !to.contains(e.currentTarget) ? 'away' : 'nowhere'
        }
        commit()
      },
      onKeyDown: e => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); revert() }
        onKeyDown?.(e)
      },
      onClick: stopClick ? (e => e.stopPropagation()) : undefined,
      'aria-label': label,
    }
    if (isValidElement(field)) return cloneElement(field, behaviour)
    return <input {...behaviour} type="text" className="ui-input" data-size="sm" />
  }

  const open = (e) => {
    if (stopClick) e.stopPropagation()
    setEditing(true)
  }
  const content = shown || placeholder
  if (isValidElement(words)) {
    return cloneElement(words, {
      ref: wordsRef,
      onClick: open,
      // A span is focusable by script only: focus comes back to it, and the
      // row gains no tab stop (C1).
      ...(words.type === 'span' ? { tabIndex: -1 } : null),
    }, content)
  }
  return (
    <button ref={wordsRef} type="button" className="ui-inline-text" data-empty={saved ? undefined : 'true'} onClick={open}>
      {content}
    </button>
  )
}

export default useInlineText
