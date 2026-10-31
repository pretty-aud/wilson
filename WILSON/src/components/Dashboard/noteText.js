// ============================================================
// WILSON Dashboard — noteText (post-overhaul DG1, 2026-10-16)
// ============================================================
//
// The ONE definition of a note's editor, and the ONE way a note's text is
// read outside the Notes page.
//
// A note's body is a Yjs document (`notes.ydoc_state`, base64; migration
// 0017). `body_preview` is a 300-character derived summary for the list and
// is never the note. NotesView reads the body by mounting TipTap over a fresh
// Y.Doc with the Collaboration extension, applying the stored state, and
// asking the editor for its text. D.O.G. (references) needs the same text
// without a screen, so this module owns the extension list both use, and
// `noteTextFromState` does exactly what NotesView does: an editor over a
// fresh Y.Doc, the state applied AFTER the editor exists (NotesView's
// order: the Collaboration binding renders the update as it lands), then
// `editor.getText()`. There is no second decoder: walking the Y.XmlFragment
// by hand would be a second way, and the two would drift the first time a
// node type is added to the editor.
//
// v3 traps, kept with the list: StarterKit's 'history' became 'undoRedo'
// and it MUST be off with Collaboration (which ships its own Yjs undo
// manager); Underline and Link are part of the v3 StarterKit.
//
// The editor must be MOUNTED for the binding to exist (an unmounted v3
// editor has no view, and the Collaboration plugin renders into the view).
// TipTap's default element is a detached <div>, which is enough; nothing is
// attached to the page, and `injectCSS: false` keeps the reader from adding
// TipTap's stylesheet to <head>. Browser (renderer) only, like NotesView.

import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { b64ToU8 } from './noteSync'

/** The note editor's extensions, over one Y.Doc. NotesView and the reader. */
export function noteEditorExtensions(ydoc) {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false },
    }),
    Collaboration.configure({ document: ydoc }),
  ]
}

/**
 * A note's whole text, from its stored Yjs state (`notes.ydoc_state`).
 * '' for an empty note (a NULL state is an empty document). Throws only if
 * the state is not a Yjs update, which a caller reports as "could not be read".
 *
 * @param {string|null|undefined} b64
 * @returns {string}
 */
export function noteTextFromState(b64) {
  if (!b64) return ''
  const ydoc = new Y.Doc()
  const editor = new Editor({
    extensions: noteEditorExtensions(ydoc),
    editable: false,
    injectCSS: false,
  })
  try {
    Y.applyUpdate(ydoc, b64ToU8(b64), 'remote-load')
    return editor.getText()
  } finally {
    editor.destroy()
    ydoc.destroy()
  }
}
