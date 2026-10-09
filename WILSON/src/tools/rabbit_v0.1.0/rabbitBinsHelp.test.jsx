/** @vitest-environment jsdom */
// =============================================================================
// rabbitBinsHelp.test.jsx — BC2 item 9: R.A.B.B.I.T.'s "Bins" help page says
// what the Bins tab does on the desktop signed in, in the controls' OWN
// words, so a renamed control reaches Help or fails here. The token, ink and
// sentence-case rules every help page keeps are helpContent.test.jsx's (it
// walks every page, this one included).
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RabbitHelpContent, RABBIT_HELP_SIDEBAR_ITEMS, BINS_SHORTCUTS } from './rabbitHelpContent'
import { ADD_NEEDS_DESKTOP, NOT_ON_THIS_COMPUTER, CONNECT_LABEL, NOT_CONNECTED_HERE, CATALOGUE_SENTENCE, PLAY_NEEDS_DESKTOP, POSTER_LARGE_HINT } from './bins/binLocations'
import { REMOTE_VIEWING_LABEL } from './bins/cloudPosters'
import { LOCATION_QUESTION, LEAVE_FOR_NOW } from '../../cloud/migrate/binsMigration'

afterEach(cleanup)

const page = (theme = 'dark') => render(<RabbitHelpContent helpPage="rabbit-bins" theme={theme} />).container.textContent.replace(/\s+/g, ' ')
const src = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('the "Bins" help page (BC2)', () => {
  it('is in R.A.B.B.I.T.\'s help, after Scenes & shot lists', () => {
    const ids = RABBIT_HELP_SIDEBAR_ITEMS.map((i) => i.id)
    expect(ids.indexOf('rabbit-bins')).toBe(ids.indexOf('rabbit-scenes') + 1)
    expect(RABBIT_HELP_SIDEBAR_ITEMS.find((i) => i.id === 'rabbit-bins').label).toBe('Bins')
    // CONTROL: a page that is not there draws the fallback, not this.
    expect(render(<RabbitHelpContent helpPage="rabbit-binz" theme="dark" />).container.textContent).toMatch(/Pick a topic/)
  })

  it('says the footage never moves, and a clip is a location plus a path', () => {
    const text = page()
    expect(text).toContain('WILSON never copies footage')
    expect(text).toContain('\\\\server\\footage')
    expect(text).toContain('A file in no footage location is refused, never added.')
  })

  it('names the controls as they are written', () => {
    const text = page()
    // The switch, word for word (Settings, Storage).
    expect(text).toContain(REMOTE_VIEWING_LABEL)
    // The browser's add verbs, word for word (the Bins tab).
    expect(text).toContain(ADD_NEEDS_DESKTOP)
    // "not on this computer", as the tab marks a clip (B3).
    expect(text).toContain(`marked ${NOT_ON_THIS_COMPUTER}`)
    // The per-computer question, as the three places that ask it write it.
    expect(text).toContain('Where is it on this computer?')
    for (const f of ['src/components/settings/FootageSettings.jsx', 'src/tools/rabbit_v0.1.0/views/BinsView.jsx', 'src/tools/rabbit_v0.1.0/views/bins/RelinkLocationsDialog.jsx']) {
      expect(src(f), f).toContain('Where is it on this computer?')
    }
    // Review round 1: consent before contact, in the controls' own words.
    expect(text).toContain(CONNECT_LABEL)
    expect(text).toContain(NOT_CONNECTED_HERE)
    expect(text).toContain('each computer connects to an address only once its own person agrees')
    // Where the locations and the switch live, as the Settings page names them.
    expect(text).toContain('App settings, Storage, Footage locations')
    expect(src('src/components/settings/FootageSettings.jsx')).toContain('title="Footage locations"')
  })

  it('says what the switch does to pictures, both ways (B4)', () => {
    const text = page()
    expect(text).toContain('while it is off, no picture leaves the office network')
    expect(text).toContain('Turning it off deletes nothing.')
  })

  it('names who may change bins as the gate does (B6: reviewers too)', () => {
    expect(page()).toContain('managers, members and reviewers add and remove clips and bins')
  })

  it('reads the same on the light surface', () => {
    expect(page('light')).toBe(page('dark'))
  })

  // BC3: the browser's half, in the tab's own words.
  it('says what a browser shows and what needs the desktop app, word for word (B5), and what Space does there', () => {
    const text = page()
    expect(text).toContain(CATALOGUE_SENTENCE)
    expect(text).toContain(PLAY_NEEDS_DESKTOP)
    expect(text).toContain(POSTER_LARGE_HINT)
    expect(text).toContain(`marked ${NOT_ON_THIS_COMPUTER}`)
    expect(text).toContain('New bin')
    expect(text).toContain('Remove with Undo in the toast')
    // The Space row of the keyboard list says both.
    const space = BINS_SHORTCUTS.find(s => s.keys.flat().includes('Space'))
    expect(space.does).toBe('Play or pause the preview; in a browser, show the picture large')
    // …and the view has the words it quotes (a renamed control reaches Help or fails here).
    expect(src('src/tools/rabbit_v0.1.0/views/BinsView.jsx')).toContain('CATALOGUE_SENTENCE')
    expect(src('src/tools/rabbit_v0.1.0/views/BinsView.jsx')).toContain('New bin')
  })

  // BC3 (B9): the move, in the panel's own words.
  it('says how a desktop project\'s bins move to the cloud, in the migration panel\'s words', () => {
    const text = page()
    expect(text).toContain('App settings, Storage, Migrate to cloud')
    expect(text).toContain(LOCATION_QUESTION)
    expect(text).toContain(LEAVE_FOR_NOW)
    expect(text).toContain('never dropped')
    expect(text).toContain(`only while ${REMOTE_VIEWING_LABEL} is on`)
    expect(text).toContain('Running it again changes nothing already there.')
    const panel = src('src/cloud/migrate/MigrationPanel.jsx')
    expect(panel).toContain("MIGRATE_TITLE = 'Migrate to cloud'")
    expect(panel).toContain('LOCATION_QUESTION')
    expect(panel).toContain('LEAVE_FOR_NOW')
    expect(src('src/components/SettingsPage.jsx')).toContain("{ key: 'rabbit',  label: 'Storage' }")
  })
})
