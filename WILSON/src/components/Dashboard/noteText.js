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
//
// MO3 (0127): a typed link is TEXT in the body, [[words|m:key]], the form R.A.B.B.I.T.'s fields hold — never a
// node or a mark. The Yjs binding deletes from the shared document any node or mark its schema does not know, so
// a mention node would be erased (and the erasure saved) the first time a build without it opened the note; text
// survives every build, an older one showing the token as typed. NoteMentions draws the words as a link when its
// reader sees what it leads to (setSeenMentions: the note's links as the server answers them for that reader), and
// as its words alone otherwise, with no hint a link was there; the brackets and key are out of sight either way, and
// a Backspace or Delete at a token's edge takes the whole token. The reader
// gives the words alone (mentionPlainText): D.O.G. reads a note as its reader sees it, with no key.

import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { b64ToU8 } from './noteSync'
import { mentionPlainText } from '../../tools/rabbit_v0.1.0/state/mentionTokens'

const TOKEN = /\[\[([^\][|\u0000-\u001f\u007f]{1,200})\|m:([0-9a-f]{12})\]\]/g
const mentionsKey = new PluginKey('noteMentions')

// Every whole token in a text node: [from, to, wordsFrom, wordsTo, key], in document positions.
function tokensIn(doc) {
  const out = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text.includes('[[')) return
    for (const m of node.text.matchAll(TOKEN)) {
      const from = pos + m.index
      out.push([from, from + m[0].length, from + 2, from + 2 + m[1].length, m[2]])
    }
  })
  return out
}

export const NoteMentions = Extension.create({
  name: 'noteMentions',
  addProseMirrorPlugins() {
    const draw = (doc, seen) => DecorationSet.create(doc, tokensIn(doc).flatMap(([from, to, wf, wt, key]) => [
      Decoration.inline(from, wf, { class: 'note-mention-syntax' }),
      Decoration.inline(wf, wt, seen.has(key) ? { class: 'note-mention', 'data-key': key } : { class: 'note-mention-plain' }),
      Decoration.inline(wt, to, { class: 'note-mention-syntax' }),
    ]))
    return [new Plugin({
      key: mentionsKey,
      state: {
        // Until the reader's links are known, every token is its words alone.
        init: (_, state) => ({ seen: new Set(), deco: draw(state.doc, new Set()) }),
        apply: (tr, old) => {
          const meta = tr.getMeta(mentionsKey)
          if (!meta && !tr.docChanged) return old
          const seen = meta?.seen ? new Set(meta.seen) : old.seen
          return { seen, deco: draw(tr.doc, seen) }
        },
      },
      props: {
        decorations: (state) => mentionsKey.getState(state)?.deco,
        // A token goes whole: Backspace at its end, or Delete at its start, takes it all.
        handleKeyDown: (view, event) => {
          if (event.key !== 'Backspace' && event.key !== 'Delete') return false
          const { empty, from } = view.state.selection
          if (!empty) return false
          const hit = tokensIn(view.state.doc).find(([a, b]) => (event.key === 'Backspace' ? b === from : a === from))
          if (!hit) return false
          view.dispatch(view.state.tr.delete(hit[0], hit[1]))
          return true
        },
      },
    })]
  },
})

/** MO3: the keys of the links this note's reader sees; every other token is drawn as its words alone. */
export function setSeenMentions(editor, keys) {
  try {
    if (!editor || editor.isDestroyed) return
    const view = editor.view
    view.dispatch(view.state.tr.setMeta(mentionsKey, { seen: [...(keys || [])] }).setMeta('addToHistory', false))
  } catch { /* not mounted yet: the next change of links draws them */ }
}

/** The note editor's extensions, over one Y.Doc. NotesView and the reader. */
export function noteEditorExtensions(ydoc) {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false },
    }),
    Collaboration.configure({ document: ydoc }),
    NoteMentions,
  ]
}

/**
 * A note's whole text, from its stored Yjs state (`notes.ydoc_state`), as its reader sees it: a typed link reads
 * as its words alone (0127), with no key.
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
    return mentionPlainText(editor.getText())
  } finally {
    editor.destroy()
    ydoc.destroy()
  }
}
