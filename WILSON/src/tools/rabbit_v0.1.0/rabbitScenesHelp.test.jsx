/** @vitest-environment jsdom */
// =============================================================================
// rabbitScenesHelp.test.jsx — post-overhaul S3b: R.A.B.B.I.T.'s "Scenes &
// shot lists" help page names the Scenes tab's shot-list controls in the
// controls' OWN words, so a rename on the tab reaches Help or fails here
// (rabbitFilesHelp.test.jsx's shape). The token, ink and sentence-case rules
// every help page keeps are helpContent.test.jsx's (it walks this one too).
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { RabbitHelpContent, RABBIT_HELP_SIDEBAR_ITEMS } from './rabbitHelpContent'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, p), 'utf8')
const page = (theme = 'dark') => render(<RabbitHelpContent helpPage="rabbit-scenes" theme={theme} />).container.textContent.replace(/\s+/g, ' ')

describe('the "Scenes & shot lists" help page (S3b)', () => {
  it('is in R.A.B.B.I.T.\'s help, after Assets', () => {
    const ids = RABBIT_HELP_SIDEBAR_ITEMS.map((i) => i.id)
    expect(ids.indexOf('rabbit-scenes')).toBe(ids.indexOf('rabbit-assets') + 1)
    expect(RABBIT_HELP_SIDEBAR_ITEMS.find((i) => i.id === 'rabbit-scenes').label).toBe('Scenes & shot lists')
    // CONTROL: a page that is not there draws the fallback, not this.
    expect(render(<RabbitHelpContent helpPage="rabbit-scene" theme="dark" />).container.textContent).toMatch(/Pick a topic/)
  })

  // Each name the page uses, and where the tab draws it in those words.
  const CONTROLS = [
    ['New shot list', './views/scenes/ShotListBar.jsx', /New shot list\n?\s*</],
    ['Shot lists…', './views/scenes/ShotListBar.jsx', /Shot lists…/],
    ['Save as…', './views/scenes/ShotListBar.jsx', /Save as…/],
    ['Set active', './views/scenes/ShotListBar.jsx', /Set active/],
    // The menu's LIVE items (each verb also has a greyed twin with the same
    // words, which alone would not prove the live one kept them).
    ['Add from another list…', './views/scenes/ShotLists.jsx', /label: 'Add from another list…', Icon: ListPlus, onClick/],
    ['Edit details…', './views/scenes/ShotLists.jsx', /label: 'Edit details…', Icon: Pencil, onClick/],
    ['Clear this list', './views/scenes/ShotLists.jsx', /label: 'Clear this list', Icon: Eraser, onClick/],
    ['Withdraw', './views/scenes/ShotLists.jsx', /label: 'Withdraw', Icon: Undo2, onClick/],
    ['Archive', './views/scenes/ShotLists.jsx', /label: 'Archive', Icon: Archive, onClick/],
    ['Not in any list', './views/scenes/ShotListPicker.jsx', /Not in any list \(/],
    ['Archived…', './views/scenes/ShotListPicker.jsx', /Archived… \(/],
    ['Remove from this list', './views/ScenesView.jsx', /label: 'Remove from this list'/],
    ['Remove from list', './views/ScenesView.jsx', />\s*Remove from list\s*</],
    ['Move up', './views/ScenesView.jsx', /label: 'Move up'/],
    ['Move down', './views/ScenesView.jsx', /label: 'Move down'/],
    ['List order', './views/ScenesView.jsx', /'List order'/],
  ]
  it('names the shot-list controls by the tab\'s own labels', () => {
    const text = page()
    for (const [name, file, drawn] of CONTROLS) {
      expect(text, name).toContain(name)
      expect(read(file), `${file} no longer says "${name}"`).toMatch(drawn)
    }
  })

  it('says the three rules S3a states: one row in many lists, viewing is not active, and who may do what', () => {
    const text = page()
    expect(text).toContain('A scene or shot is one row shared by every shot list that holds it')
    expect(text).toContain('The Timeline, Budget, Tasks, Assets, Bins and every other tab show only the active list\'s scenes and shots.')
    expect(text).toContain('Reviewers can make and change shot lists, but cannot add, rename or delete a scene or shot.')
    expect(text).toContain('On the Local Server there are no roles, so everything is open.')
    // Remove is not Delete, in the page's words.
    expect(text).toContain('nothing is deleted, and every other list keeps it')
    expect(text).toContain('Deletes the scene or shot from the project, and so from every list that holds it.')
  })

  // Review round 1 (R1-10): the page promised a way back to a Save, and that
  // any window over the tab stopped the keys; neither is what the tab does.
  // R1-08: Clear is never offered on the active list.
  it('says only what the tab does: Save reads nothing back; what stops the keys; Clear never on the active list', () => {
    const text = page()
    expect(text).not.toMatch(/come back to/)
    expect(text).toContain('the bar says "Saved" with the date until the list next changes')
    expect(read('./views/scenes/ShotListBar.jsx')).toMatch(/`Saved \$\{showDate\(saveState\.at\)\}`/)
    expect(text).toContain('in its scene and shot windows and in the windows they open, but not while you type in a field, nor while a menu, a question, the settings drawer or a shot-list window is open.')
    expect(text).toContain('Clear this list (never on the active list, and only before it is first saved)')
    expect(read('./views/scenes/ShotLists.jsx')).toMatch(/gate\.write && rowSave\?\.kind === 'never' && held && !rowActive/)
  })

  it('draws on both surfaces (the Help page is light, the tool\'s dialog dark)', () => {
    expect(page('light')).toBe(page('dark'))
    expect(page('light').length).toBeGreaterThan(1500)
  })
})
