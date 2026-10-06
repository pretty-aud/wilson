/** @vitest-environment jsdom */
// =============================================================================
// rabbitFilesHelp.test.jsx — post-overhaul S4a, E13: R.A.B.B.I.T.'s "Files"
// help page says what the Files tab does in the controls' OWN words, so a
// rename there, a tenth tag or a change to a rule reaches Help or fails here.
// The token, ink and sentence-case rules every help page keeps are
// helpContent.test.jsx's (it walks every page, this one included).
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { RabbitHelpContent, RABBIT_HELP_SIDEBAR_ITEMS } from './rabbitHelpContent'
import { FILE_TAGS, LEGAL_ADD_HINT, LEGAL_LOCAL_NOTE, tagSettable } from './fileTags'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, p), 'utf8')
const page = (theme = 'dark') => render(<RabbitHelpContent helpPage="rabbit-files" theme={theme} />).container.textContent.replace(/\s+/g, ' ')

describe('the "Files" help page (E13)', () => {
  it('is in R.A.B.B.I.T.\'s help, after Projects', () => {
    const ids = RABBIT_HELP_SIDEBAR_ITEMS.map((i) => i.id)
    expect(ids.indexOf('rabbit-files')).toBe(ids.indexOf('rabbit-projects') + 1)
    expect(RABBIT_HELP_SIDEBAR_ITEMS.find((i) => i.id === 'rabbit-files').label).toBe('Files')
    // CONTROL: a page that is not there draws the fallback, not this.
    expect(render(<RabbitHelpContent helpPage="rabbit-filez" theme="dark" />).container.textContent).toMatch(/Pick a topic/)
  })

  it('names every tag as the file window does, and no other', () => {
    const text = page()
    for (const t of FILE_TAGS) expect(text, t.label).toContain(t.label)
    const listed = /Tags — ([^;]+);/.exec(text)?.[1]
    expect(listed, 'the tag sentence').toBeTruthy()
    expect(listed.replace(' and ', ', ').split(', ')).toEqual(FILE_TAGS.map((t) => t.label))
  })

  it('says Finance and Legal as the editor does', () => {
    const text = page()
    expect(text).toContain(tagSettable('finance').reason)
    // S4b (0088): Legal is chosen at Add files and stays; who sees it is the
    // money gate's audience, in Add as Legal's own sentence; and the Local
    // Server line says the folder is not a lock there (A9).
    expect(text).toContain(LEGAL_ADD_HINT)
    expect(text).toContain('Legal is chosen when a file is added, with Add as Legal')
    expect(text).toContain('to change it you add the file again')
    expect(text).toContain('Legal is a folder, not a lock: restrict the LEGAL folder on the drive or NAS itself.')
    expect(LEGAL_LOCAL_NOTE).toContain('Legal is a folder, not a lock: restrict the LEGAL folder on the drive or NAS itself.')
    expect(text).not.toMatch(/not restricted yet|does not hide a file yet/)
  })

  it('names the controls the explorer draws, by the explorer\'s own labels', () => {
    const text = page()
    const explorer = read('../../components/Resources/ProjectFilesExplorer.jsx')
    for (const name of ['Add files', 'Add as Legal', 'File activity', 'Preview', 'Download', 'Show in folder']) {
      expect(text, name).toContain(name)
      expect(explorer, `the explorer no longer says "${name}"`).toMatch(new RegExp(`>\\s*${name}\\s*<|title="${name}"`))
    }
    expect(text).toContain('Open in default app')
    expect(explorer).toContain('title="Open in default app"')
    expect(explorer).toContain('Relink…')
  })

  // Post-overhaul S4c: the explorer's navigation, where shot folders live
  // now, and the one-time move — in the explorer's own words.
  it('says how the Table navigates, where a shot\'s folder lives, and names the one-time move by the explorer\'s own label (S4c)', () => {
    const text = page()
    const explorer = read('../../components/Resources/ProjectFilesExplorer.jsx')
    expect(text).toContain('Table shows one folder at a time, like Windows Explorer')
    expect(text).toContain('Project › SCENES')
    for (const key of ['Backspace', 'Alt', 'Enter', 'Home', 'End']) expect(text, key).toContain(key)
    expect(text).toContain('every match from the whole project, with its folder in the Location column')
    expect(text).toContain('Clear it to return to the folder you were in')
    expect(explorer).toContain('(Backspace)')
    expect(explorer).toContain('across the project')
    // The folders: a shot's inside its scene's; levels and experiences have theirs.
    expect(text).toContain('A shot\'s folder lives inside its scene\'s: SCENES, the scene, then the shot.')
    expect(text).toContain('A level\'s is under LEVELS and an experience\'s under EXPERIENCES')
    expect(text).toContain('A shot with no scene')
    // The move, by the button's label, and the two facts the question states.
    expect(text).toContain('Move shot folders into their scenes…')
    expect(explorer).toMatch(/>\s*Move shot folders into their scenes…\s*</)
    expect(text).toContain('nothing is deleted')
    expect(text).toContain('you can run it again for the rest')
    expect(explorer).toContain('nothing is deleted')
    expect(explorer).toContain('you can run it again for the rest')
    expect(text).toContain('The empty SHOTS folder goes once nothing is left in it.')
    // The old flat-list sentence is gone.
    expect(text).not.toContain('Table lists every file')
    // The Scenes page says it too, once.
    const scenes = render(<RabbitHelpContent helpPage="rabbit-scenes" theme="dark" />).container.textContent
    expect(scenes).toContain('its shots\' folders sit inside it')
    expect(scenes).toContain('the Files tab\'s one-time move')
  })

  it('draws on both surfaces (the Help page is light, the tool\'s dialog dark)', () => {
    expect(page('light')).toBe(page('dark'))
    expect(page('light').length).toBeGreaterThan(1500)
  })
})
