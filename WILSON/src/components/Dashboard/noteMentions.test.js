// @vitest-environment jsdom
// MO3 (PLAN_MOTH S3, acceptance 5): in a note, a typed link is drawn as a link only when its reader sees what it leads
// to; any other token is its words alone, with no hint, and the brackets and key are never shown. The words of the note
// are not changed by how they are drawn.
import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { noteEditorExtensions, setSeenMentions } from './noteText'

const SEEN = 'a1b2c3d4e5f6'
const HIDDEN = 'b2c3d4e5f6a1'
const TEXT = `Keep it in frame whenever [[Mara|m:${SEEN}]] is in the café, as in [[the lantern sketch|m:${HIDDEN}]].`

let editor = null
afterEach(() => { editor?.destroy(); editor = null })

function open() {
  const ydoc = new Y.Doc()
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  ydoc.getXmlFragment('default').push([p])
  p.push([t])
  t.insert(0, TEXT)
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: noteEditorExtensions(ydoc) })
  return element
}

describe("a note's typed links, as its reader sees them", () => {
  it('before its links are known, every token is its words alone', () => {
    const el = open()
    expect(el.querySelectorAll('.note-mention').length).toBe(0)
    expect([...el.querySelectorAll('.note-mention-plain')].map((n) => n.textContent)).toEqual(['Mara', 'the lantern sketch'])
  })

  it('a link the reader sees is drawn as one; the other stays its words, with no key anywhere', () => {
    const el = open()
    setSeenMentions(editor, [SEEN])
    expect([...el.querySelectorAll('.note-mention')].map((n) => [n.textContent, n.getAttribute('data-key')])).toEqual([['Mara', SEEN]])
    expect([...el.querySelectorAll('.note-mention-plain')].map((n) => n.textContent)).toEqual(['the lantern sketch'])
    expect(el.innerHTML).not.toContain(`data-key="${HIDDEN}"`)
    expect(editor.getText()).toBe(TEXT)
  })

  it('a token whose words carry a mark (one word bold) is still one token: drawn as its words, its key out of sight', () => {
    const el = open()
    // Bold "lantern" inside the second token, so its words span two text nodes.
    const at = TEXT.indexOf('lantern') + 1
    editor.chain().setTextSelection({ from: at, to: at + 'lantern'.length }).toggleBold().run()
    setSeenMentions(editor, [SEEN, HIDDEN])
    const drawn = [...el.querySelectorAll('.note-mention')].filter((n) => n.getAttribute('data-key') === HIDDEN)
    expect(drawn.map((n) => n.textContent).join('')).toBe('the lantern sketch')
    expect([...el.querySelectorAll('.note-mention-syntax')].map((n) => n.textContent).join('')).toContain(`|m:${HIDDEN}]]`)
    expect(editor.getText()).toBe(TEXT)
  })
})
