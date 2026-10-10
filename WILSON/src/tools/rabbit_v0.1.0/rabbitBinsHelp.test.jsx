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
    // …and the view has the words it quotes (a renamed control reaches Help
    // or fails here): the toolbar's button, as written.
    expect(src('src/tools/rabbit_v0.1.0/views/BinsView.jsx')).toContain('CATALOGUE_SENTENCE')
    expect(src('src/tools/rabbit_v0.1.0/views/BinsView.jsx')).toMatch(/<Plus className="w-3 h-3" \/> New bin\s*<\/Btn>/)
  })

  // BC3 (B9): the move, in the panel's own words.
  it('says how a desktop project\'s bins move to the cloud, in the migration panel\'s words', () => {
    const text = page()
    expect(text).toContain('App settings, Storage, Migrate to cloud')
    expect(text).toContain(LOCATION_QUESTION)
    expect(text).toContain(LEAVE_FOR_NOW)
    expect(text).toContain('never dropped')
    expect(text).toContain(`only while ${REMOTE_VIEWING_LABEL} is on`)
    // Review round 1: a second run brings back a row removed from the cloud
    // since (every table of the runner always did); Help says so plainly.
    expect(text).toContain('Running it again skips every row already in the cloud; a row a teammate removed from the cloud since comes back with it')
    expect(text).toContain('Use this address')
    const panel = src('src/cloud/migrate/MigrationPanel.jsx')
    expect(panel).toContain("MIGRATE_TITLE = 'Migrate to cloud'")
    expect(panel).toContain("USE_THIS_ADDRESS = 'Use this address'")
    expect(panel).toContain('LOCATION_QUESTION')
    expect(panel).toContain('LEAVE_FOR_NOW')
    expect(src('src/components/SettingsPage.jsx')).toContain("{ key: 'rabbit',  label: 'Storage' }")
  })
})

// GW1 (2026-10-10): the file gateway, beside Footage locations — §3's
// certificate paragraph verbatim, the install stories named as the card's
// tabs name them, every control in the card's own words.
describe('the "Bins" help page: File gateway (GW1)', () => {
  // The card itself, by its own title: the page's other cards say some of
  // the same words (the switch's name), so the gateway's are read here.
  const gatewayCard = () => {
    const { container } = render(<RabbitHelpContent helpPage="rabbit-bins" theme="dark" />)
    const h = [...container.querySelectorAll('h4')].find((x) => x.textContent === 'File gateway')
    expect(h, 'Help → Bins has a card titled File gateway').toBeTruthy()
    return h.parentElement.textContent.replace(/\s+/g, ' ')
  }
  it('sits beside Footage locations, titled File gateway', () => {
    const { container } = render(<RabbitHelpContent helpPage="rabbit-bins" theme="dark" />)
    const titles = [...container.querySelectorAll('h4')].map((x) => x.textContent)
    expect(titles.indexOf('File gateway')).toBe(titles.indexOf('Footage locations') + 1)
  })

  it('quotes §3\'s certificate paragraph word for word', async () => {
    const { GATEWAY_CERT_PARAGRAPH } = await import('../../components/settings/gatewayWords')
    const paragraph = GATEWAY_CERT_PARAGRAPH.map((p) => (typeof p === 'string' ? p : p.em)).join('')
    expect(gatewayCard()).toContain(paragraph)
    // CONTROL: the design's own text, so neither copy drifts from §3.
    const design = src('docs/design/GATEWAY_DESIGN.md').replace(/\*/g, '')
    expect(design).toContain(paragraph)
  })

  it('names the card, its tabs and its controls as GatewaySettings writes them', async () => {
    const { IT_WORKS } = await import('../../components/settings/gatewayWords')
    const text = gatewayCard()
    const card = src('src/components/settings/GatewaySettings.jsx')
    expect(text).toContain('App settings, Storage, File gateway')
    // Both of the card's views (an admin's and everyone else's) carry the title Help names.
    expect(card.match(/<Section title="File gateway"/g)).toHaveLength(2)
    for (const words of ['On a NAS', 'On a Windows PC']) {
      expect(text).toContain(words)
      expect(card).toContain(`label: '${words}'`)
    }
    for (const control of ['Add a gateway', 'Download certificate', 'Check reach', 'Forget']) {
      expect(text, control).toContain(control)
      expect(card, control).toContain(control)
    }
    expect(text).toContain(IT_WORKS)
    expect(text).toContain('Viewed from outside the office')
  })

  it('says office and VPN viewing is not written down (review round 2, R9), and the switch decides the rest', () => {
    const text = gatewayCard()
    expect(text).toContain('viewing on the office network or the company\'s VPN is not')
    expect(text).toContain(`only while a workspace admin has turned on ${REMOTE_VIEWING_LABEL}`)
  })
})
