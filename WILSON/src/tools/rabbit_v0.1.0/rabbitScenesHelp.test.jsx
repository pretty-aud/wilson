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
  // R1-08 took Clear off the active list; review round 2 (R2-07) put it
  // back, as D4 rules — its question says what it does to the other tabs.
  // R2-04: what a selection holds.
  it('says only what the tab does: Save reads nothing back; what stops the keys; Clear as D4 rules; what a selection holds', () => {
    const text = page()
    expect(text).not.toMatch(/come back to/)
    expect(text).toContain('the bar says "Saved" with the date until the list next changes')
    expect(read('./views/scenes/ShotListBar.jsx')).toMatch(/`Saved \$\{showDate\(saveState\.at\)\}`/)
    expect(text).toContain('in its scene and shot windows and in the windows they open, but not while you type in a field, while a menu, a question, the settings drawer or a shot-list window is open, or while a delete of several rows is still going.')
    expect(text).toContain('Clear this list (only before it is first saved)')
    expect(read('./views/scenes/ShotLists.jsx')).toMatch(/gate\.write && rowSave\?\.kind === 'never' && held\) \{/)
    expect(text).toContain('Holds only what is on screen: opening another list, a search or a filter unticks the rows it hides, and closing a scene unticks its shots. A scene\'s own bar acts on its own ticked shots.')
  })

  it('draws on both surfaces (the Help page is light, the tool\'s dialog dark)', () => {
    expect(page('light')).toBe(page('dark'))
    expect(page('light').length).toBeGreaterThan(1500)
  })
})

// Post-overhaul S3c, step 8: the page gains edits, in the controls' own words.
describe('the help page\'s edits (S3c)', () => {
  const EDIT_CONTROLS = [
    ['List order', './views/scenes/ShotListBar.jsx', /placeholder="List order"/],
    ['Edit runtime', './views/ScenesView.jsx', /<BigTile label="Edit runtime"/],
    ['Missing shot', './views/scenes/editModel.js', /export const MISSING_SHOT = 'Missing shot'/],
    ['Make a new edit from this list?', './views/scenes/editCopy.js', /title: 'Make a new edit from this list\?'/],
    ['Make a new version of this edit?', './views/scenes/editCopy.js', /title: 'Make a new version of this edit\?'/],
    ['Start new edit', './views/scenes/editCopy.js', /confirmLabel: 'Start new edit'/],
    ['Start new version', './views/scenes/editCopy.js', /confirmLabel: 'Start new version'/],
    ['New edit from this list', './views/scenes/ShotLists.jsx', /label: 'New edit from this list', Icon: Scissors, onClick/],
    ['Move up', './views/ScenesView.jsx', /\{ label: 'Move up', Icon: ArrowUp, disabled: cutSearching/],
    ['Duplicate in edit', './views/ScenesView.jsx', /label: 'Duplicate in edit'/],
    ['Add shot…', './views/ScenesView.jsx', /label: 'Add shot…'/],
    ['New shot', './views/ScenesView.jsx', /label: 'New shot',/],
    ['Remove from edit', './views/ScenesView.jsx', /label: 'Remove from edit'/],
    ['Move scene up', './views/ScenesView.jsx', /label: 'Move scene up'/],
    ['Duplicate scene in edit', './views/ScenesView.jsx', /label: 'Duplicate scene in edit'/],
    ['Remove scene from edit', './views/ScenesView.jsx', /label: 'Remove scene from edit'/],
    ['Save edit', './views/scenes/ShotLists.jsx', />\s*Save edit\s*</],
    ['Same title, next version', './views/scenes/SaveEditDialog.jsx', /label="Same title, next version"/],
    ['Discard changes', './views/scenes/ShotLists.jsx', />Discard changes</],
    ['Unsaved', '../../ui/Button.jsx', /: 'Unsaved'/],
    ['Recover unsaved edit?', './views/scenes/ShotLists.jsx', /title="Recover unsaved edit\?"/],
    ['Keep editing', './views/scenes/LeaveEditDialog.jsx', /stayLabel="Keep editing"/],
    ['Archive this edit', './views/scenes/ShotLists.jsx', /label: 'Archive this edit', Icon: Archive, onClick/],
  ]
  it('names the edit controls by the tab\'s own labels', () => {
    const text = page()
    for (const [name, file, drawn] of EDIT_CONTROLS) {
      expect(text, name).toContain(name)
      expect(read(file), `${file} no longer says "${name}"`).toMatch(drawn)
    }
  })
  it('says what an edit is, that a drag on the list never moves the list, what asks and what does not', () => {
    const text = page()
    expect(text).toContain('A shot keeps its name in every edit; only the order is the edit\'s.')
    expect(text).toContain('the list itself does not change')
    expect(text).toContain('Nothing asks again until the edit is saved or discarded.')
    expect(text).toContain('A change WILSON makes by itself (a tab turned off, the project closed) does not ask, and the unsaved edit is kept.')
    expect(text).toContain('While an edit is unsaved they undo and redo its own changes instead, on every backend.')
    expect(text).toContain('with reduced motion the pulse stops and the word stays')
  })
  it('CONTROL: a label renamed on the tab fails its pin', () => {
    const [, file, drawn] = EDIT_CONTROLS.find(([n]) => n === 'Duplicate in edit')
    expect(read(file).replace(/label: 'Duplicate in edit'/g, "label: 'Repeat in edit'")).not.toMatch(drawn)
  })
})
