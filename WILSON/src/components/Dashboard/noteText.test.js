/** @vitest-environment jsdom */
// noteText.test.js — post-overhaul DG1 (2026-10-16).
//
// D.O.G. reads a note's whole text for a deck. It must read exactly what the
// Notes page shows, which is why noteText.js owns the editor's extension list
// and NotesView imports it rather than keeping its own.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as Y from 'yjs'
import { noteTextFromState, noteEditorExtensions } from './noteText'
import { u8ToB64 } from './noteSync'

const here = dirname(fileURLToPath(import.meta.url))

// The shape the dev fixtures (src/dev/fixtures/data/notes.js) and the editor
// write: one XmlElement('paragraph') per line in the 'default' fragment.
function stateOf(blocks) {
  const doc = new Y.Doc()
  const frag = doc.getXmlFragment('default')
  doc.transact(() => {
    for (const [tag, text, attrs] of blocks) {
      const el = new Y.XmlElement(tag)
      if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
      const t = new Y.XmlText()
      frag.push([el])
      el.push([t])
      t.insert(0, text)
    }
  })
  const b64 = u8ToB64(Y.encodeStateAsUpdate(doc))
  doc.destroy()
  return b64
}

describe('noteTextFromState', () => {
  it('reads every paragraph of the note, in order', () => {
    const b64 = stateOf([
      ['paragraph', 'Opening works better with the door shot first.'],
      ['paragraph', 'Sofia to re-time the café scene.'],
    ])
    expect(noteTextFromState(b64)).toBe(
      'Opening works better with the door shot first.\n\nSofia to re-time the café scene.')
  })

  it('reads a heading as text, as the editor shows it', () => {
    const b64 = stateOf([
      ['heading', 'Shoot week one', { level: 1 }],
      ['paragraph', 'Cliff path permit: council needs two weeks.'],
    ])
    expect(noteTextFromState(b64)).toBe('Shoot week one\n\nCliff path permit: council needs two weeks.')
  })

  it('reads the WHOLE note, not the 300-character preview', () => {
    const long = 'x'.repeat(2000)
    expect(noteTextFromState(stateOf([['paragraph', long]]))).toHaveLength(2000)
  })

  it('reads an empty note (a NULL state) as empty', () => {
    expect(noteTextFromState(null)).toBe('')
    expect(noteTextFromState('')).toBe('')
  })

  it('throws on a state that is not a Yjs update, so a caller can say so', () => {
    expect(() => noteTextFromState(btoa('not a yjs update'))).toThrow()
  })

  it('leaves nothing in the page: no element, no stylesheet', () => {
    const before = document.head.innerHTML + document.body.innerHTML
    noteTextFromState(stateOf([['paragraph', 'quiet']]))
    expect(document.head.innerHTML + document.body.innerHTML).toBe(before)
  })
})

describe('one definition of the note editor', () => {
  const notesView = readFileSync(join(here, 'NotesView.jsx'), 'utf8')

  it('NotesView builds its editor from the shared extension list', () => {
    expect(notesView).toMatch(/extensions:\s*noteEditorExtensions\(ydoc\)/)
  })

  it('and configures no extension of its own (a second list would drift)', () => {
    expect(notesView).not.toMatch(/StarterKit\.configure|Collaboration\.configure/)
  })

  it('the list keeps undoRedo off beside Collaboration (the v3 trap)', () => {
    const exts = noteEditorExtensions(new Y.Doc())
    const kit = exts.find((e) => e.name === 'starterKit')
    expect(kit?.options?.undoRedo).toBe(false)
    expect(exts.some((e) => e.name === 'collaboration')).toBe(true)
  })
})
