// boardsE2ePins.test.js — MO4: what tests/e2e/boards.spec.ts selects, pinned to the source that draws it.
//
// That spec runs only in CI: it signs in to the hosted dev project with a password this computer does not have. A
// renamed button or attribute would be found there, minutes after the push, by a spec nobody could run first. Each
// line below names a thing the spec presses or reads and the source line that puts it on the page: change either
// side alone and this fails before the push. (authSelectors.test.js does the same for the sign-in specs.)
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const MOTH = 'src/tools/moth_v0.1.0'

// [in the spec, the source file, in the source]
const PINS = [
  ["'[data-moth-page]'", `${MOTH}/MothPage.jsx`, 'data-moth-page'],
  ["'Everything by folders'", `${MOTH}/components/MothFirstVisit.jsx`, '>Everything by folders<'],
  ["name: 'Everything', exact: true", `${MOTH}/components/MothListWidget.jsx`, '>Everything<'],
  ["getByTitle('More for this project')", `${MOTH}/MothPage.jsx`, "'More for this project'"],
  ["getByText('New board', { exact: true })", `${MOTH}/MothPage.jsx`, "label: 'New board', onClick"],
  ["'[data-moth-board-make]'", `${MOTH}/MothPage.jsx`, 'data-moth-board-make>'],
  ["'[data-moth-board-make-error]'", `${MOTH}/MothPage.jsx`, 'data-moth-board-make-error'],
  ["name: 'Open board', exact: true", `${MOTH}/components/MothListWidget.jsx`, '>Open board<'],
  ["'[data-moth-board]'", `${MOTH}/board/BoardPanel.jsx`, 'data-moth-board={board.id}'],
  ["'[data-moth-board] .konvajs-content'", 'node_modules/konva/lib/Stage.js', 'konvajs-content'],
  ["'[data-moth-board-editor] textarea'", `${MOTH}/board/BoardCanvas.jsx`, 'data-moth-board-editor'],
  ["'[data-moth-board-notice]'", `${MOTH}/board/BoardCanvas.jsx`, 'data-moth-board-notice'],
  ["'is writing on this sticky'", `${MOTH}/board/BoardCanvas.jsx`, 'is writing on this sticky.'],
  ["'[data-moth-board-live-failed]'", `${MOTH}/board/BoardPanel.jsx`, 'data-moth-board-live-failed'],
  ["'[data-moth-board-trash-yes]'", `${MOTH}/board/BoardPanel.jsx`, 'data-moth-board-trash-yes'],
  ["getByTitle('Put in the trash')", `${MOTH}/board/boardPanelState.js`, "action: 'Put in the trash'"],
  ["'The board is in the trash.'", `${MOTH}/board/boardPanelState.js`, "done: 'The board is in the trash."],
  ["'Shape (S)'", `${MOTH}/board/BoardToolbar.jsx`, "label: 'Shape', key: 's'"],
  ["'Sticky note (N)'", `${MOTH}/board/BoardToolbar.jsx`, "label: 'Sticky note', key: 'n'"],
  ["'Picture or file (I)'", `${MOTH}/board/BoardToolbar.jsx`, "label: 'Picture or file', key: 'i'"],
  ["page.locator('.ui-dialog')", 'src/ui/Dialog.jsx', '`ui-dialog ${className}`'],
  ["import('/src/cloud/auth/supabaseClient.js')", 'src/cloud/auth/supabaseClient.js', 'export const supabase = createClient('],
  ['n.attrs.elementId', `${MOTH}/board/BoardCanvas.jsx`, 'elementId'],
]

describe('tests/e2e/boards.spec.ts selects what the board draws', () => {
  const spec = read('tests/e2e/boards.spec.ts')
  for (const [inSpec, file, inSource] of PINS) {
    it(`${inSpec} is drawn by ${file}`, () => {
      expect(spec).toContain(inSpec)
      expect(read(file)).toContain(inSource)
    })
  }
  it('a tool\'s title is its name and its key in capitals, as the spec presses it', () => {
    const bar = read(`${MOTH}/board/BoardToolbar.jsx`)
    expect(bar).toContain('title={`${t.label} (${t.key.toUpperCase()})`}')
    expect(bar).toContain('title={`${a.label} (${a.key.toUpperCase()})`}')
  })
  it('signs in through the one definition of signing in', () => {
    expect(spec).toContain("import { signInHere } from './authFlow'")
  })
})
