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
import { RabbitHelpContent, RABBIT_HELP_SIDEBAR_ITEMS } from './rabbitHelpContent'
import { ADD_NEEDS_DESKTOP, NOT_ON_THIS_COMPUTER } from './bins/binLocations'
import { REMOTE_VIEWING_LABEL } from './bins/cloudPosters'

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
})
