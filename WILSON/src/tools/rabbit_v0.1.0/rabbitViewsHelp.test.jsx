/** @vitest-environment jsdom */
// =============================================================================
// The help's *Views on the tasks table* card (post-overhaul VW1d, 2026-10-25)
// names the controls in the words the files that draw them use: a renamed
// button fails here, so the help never names a control that is not on
// screen (rabbitScenesHelp.test.jsx's shape). CONTROL: a word no file draws
// is not found.
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { RabbitHelpContent } from './rabbitHelpContent.jsx'

afterEach(cleanup)
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')
const CODE = ['views/tableViews/TableViewsMenu.jsx', 'views/tableViews/ViewBar.jsx', 'views/ProjectTasksView.jsx', 'state/tableViewsModel.js',
  // VW1e: the tables that took the views on.
  'views/ProjectAssetsView.jsx', 'views/EntityListView.jsx', 'views/ScenesView.jsx'].map(read).join('\n')
// A button's (or a switch's) own words in the code: between its tags, as a
// string, or as its label.
const drawn = (word) => new RegExp(`>\\s*${word}\\s*<|'${word}'|label="${word}"`).test(CODE)

describe('the help names the views\' controls in their own words', () => {
  it('each bold word of the card is drawn by the views\' files', () => {
    const { container } = render(<RabbitHelpContent helpPage="rabbit-phases" theme="dark" />)
    const card = [...container.querySelectorAll('h4')].find(h => h.textContent === 'Views on the tasks table')?.parentElement
    expect(card).toBeTruthy()
    const bold = [...card.querySelectorAll('span')].map(s => s.textContent.trim()).filter(Boolean)
    expect(bold).toEqual(['Views', 'All', 'Reset', 'Save as new view', 'Save', 'New view', 'Create grouping', 'Remove grouping', 'Hide empty groups'])
    for (const word of bold) expect(drawn(word), word).toBe(true)
  })
  it('VW1e: the Assets page and the Scenes page say which tables have views, in the same words', () => {
    const assets = render(<RabbitHelpContent helpPage="rabbit-assets" theme="dark" />).container
    const p = [...assets.querySelectorAll('p')].find(x => x.textContent.includes('Levels and Experiences'))
    expect(p).toBeTruthy()
    const bold = [...p.querySelectorAll('span')].map(s => s.textContent.trim())
    expect(bold).toEqual(['Views', 'Create grouping'])
    for (const word of bold) expect(drawn(word), word).toBe(true)
    cleanup()
    const scenes = render(<RabbitHelpContent helpPage="rabbit-scenes" theme="dark" />).container
    const card = [...scenes.querySelectorAll('h4')].find(h => h.textContent === 'Views on the scenes and shots tables')?.parentElement
    expect(card).toBeTruthy()
    expect([...card.querySelectorAll('span')].map(s => s.textContent.trim())).toEqual(['Views'])
    // The two lists (her Q16), said as the code keeps them: one table key each.
    expect(card.textContent).toContain('a view saved on one is not on the other')
    expect(read('views/tableViews/scenesTableView.js')).toMatch(/SCENES_TABLE = 'scenes'[\s\S]*SHOTS_TABLE = 'shots'/)
  })
  it('CONTROL: a word no file draws is not found', () => {
    expect(drawn('Save view for everyone')).toBe(false)
    expect(drawn('Save as new view')).toBe(true)
  })
})
