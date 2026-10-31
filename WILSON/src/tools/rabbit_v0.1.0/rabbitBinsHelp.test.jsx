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
import {
  ADD_NEEDS_DESKTOP, NOT_ON_THIS_COMPUTER, CONNECT_LABEL, NOT_CONNECTED_HERE, CATALOGUE_SENTENCE, POSTER_LARGE_HINT,
  // GW3: the gateway plays in a browser.
  CATALOGUE_GATEWAY_SENTENCE, PLAYER_LARGE_HINT, NEEDS_DESKTOP_FORMAT, GATEWAY_REACH_WORDS, CHROME_LOCAL_NETWORK_SENTENCE,
} from './bins/binLocations'
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
    expect(text).toContain(POSTER_LARGE_HINT)
    expect(text).toContain(`marked ${NOT_ON_THIS_COMPUTER}`)
    expect(text).toContain('New bin')
    expect(text).toContain('Remove with Undo in the toast')
    // GW3: the gateway plays in a browser — the notice with a gateway, Space
    // as the large player, the format that stays a picture, the four reach
    // words per location, the mark over remote playback, Chrome's prompt.
    expect(text).toContain(CATALOGUE_GATEWAY_SENTENCE)
    expect(text).toContain(PLAYER_LARGE_HINT)
    expect(text).toContain(NEEDS_DESKTOP_FORMAT)
    for (const word of Object.values(GATEWAY_REACH_WORDS)) expect(text).toContain(word)
    expect(text).toContain('a six-character member code')
    expect(text).toContain('moved every half minute')
    expect(text).toContain(CHROME_LOCAL_NETWORK_SENTENCE)
    expect(text).not.toContain('nothing plays yet')
    // The Space row of the keyboard list says all three.
    const space = BINS_SHORTCUTS.find(s => s.keys.flat().includes('Space'))
    expect(space.does).toBe('Play or pause the preview; in a browser, play the clip large through the gateway, or show its picture where it cannot play')
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
    // Review round 1: a second run brought back a row removed from the cloud
    // since; M1 (night 3) measured which. M2 (night 4): the record of what
    // each run carried — none comes back, whether removed for good or into
    // the trash. Help says so, and no longer that one comes back.
    expect(text).toContain('Running it again writes nothing already in the cloud and brings back nothing a teammate removed there since, for good or into the trash: the project on this computer keeps a record of every row a run carried, and the report names each one removed.')
    expect(text).not.toContain('comes back with it')
    // M1, M2: what moves since, what a later run carries, and what no
    // migration does (the report's two groups, binsMigration's NOT_CARRIED).
    // M3 (night 5): the team by email, the files kept with rows, the cards
    // and the templates move too; what stays is said as what no run carries.
    expect(text).toContain('A desktop project moves with its key dates, comments, shot lists and edits, its folders, its levels and experiences, the links on its tasks, its budget, its roster, the files kept with its assets, scenes, shots, levels and experiences, and its bins, logging, marks and takes; the company\'s rate cards and task templates go once')
    expect(text).toContain('A budget moves only for a workspace admin or the project\'s manager, who alone see it in the cloud; anyone else\'s run leaves it on this computer and says so.')
    expect(text).toContain('Your desktop team is matched to company accounts by email, which only a workspace admin or manager may read; anyone without an account is named in the report, and their seats, crew lines, rates and tasks arrive without the person until they join (no email is sent).')
    expect(text).toContain('A company that keeps its media on its own server keeps the files kept with its rows there; the browser says where they are.')
    expect(text).not.toContain('part 2')
    expect(text).not.toContain('The team moves in a later run')
    expect(text).toContain('What stays — the rows of a team member without a WILSON account until they join, a rate card\'s department defaults, an assignment\'s dates, a file\'s version label — and what no migration carries — deck attachments not yet moved into project files, comments on rows the cloud cannot hang a comment on, invoices attached by a path on this computer, and the pictures of scenes, shots, levels and experiences — stay on this computer')
    expect(text).toContain('Archive and clear local keeps the team, the rate cards and the templates in the archive file with the projects.')
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

  it('GW3: names the gateway\'s two added reach words beside the four (GW2\'s hand-off, "For GW3"): run share-login, and an address the gateway cannot use', () => {
    const text = gatewayCard()
    expect(text).toContain(GATEWAY_REACH_WORDS.not_connected)
    expect(text).toContain(GATEWAY_REACH_WORDS.unknown_address)
    expect(text).toContain('share-login')
  })

  it('says office and VPN viewing is not written down (review round 2, R9), and the switch decides the rest', () => {
    const text = gatewayCard()
    expect(text).toContain('viewing on the office network or the company\'s VPN is not')
    expect(text).toContain(`only while a workspace admin has turned on ${REMOTE_VIEWING_LABEL}`)
  })
})

// GW4 (2026-10-11): the two install stories as Help pages of their own, the
// ONE text the card's tabs under Add a gateway show (gatewayWords.js's
// NAS_STORY and WINDOWS_STORY): every word of a story is on its page, the card
// renders the same objects, and the hardening guide they point to exists.
describe('the install stories as Help pages (GW4)', () => {
  const storyPage = (id, theme = 'dark') => render(<RabbitHelpContent helpPage={id} theme={theme} />).container
  const flat = (s) => s.replace(/\s+/g, ' ')
  it('sit right after Bins in R.A.B.B.I.T.\'s help, labelled as Help names them', () => {
    const ids = RABBIT_HELP_SIDEBAR_ITEMS.map((i) => i.id)
    expect(ids.slice(ids.indexOf('rabbit-bins'), ids.indexOf('rabbit-bins') + 3)).toEqual(['rabbit-bins', 'rabbit-gateway-nas', 'rabbit-gateway-windows'])
    expect(RABBIT_HELP_SIDEBAR_ITEMS.find((i) => i.id === 'rabbit-gateway-nas').label).toBe('File gateway on a NAS')
    expect(RABBIT_HELP_SIDEBAR_ITEMS.find((i) => i.id === 'rabbit-gateway-windows').label).toBe('File gateway on Windows')
    // The Bins page's File gateway card names them as the sidebar does.
    expect(page()).toContain('Help has both as pages of their own, File gateway on a NAS and File gateway on Windows')
  })
  it('each page shows every step, every item and every note of its story, in order, on both surfaces', async () => {
    const { NAS_STORY, WINDOWS_STORY } = await import('../../components/settings/gatewayWords')
    for (const [id, story] of [['rabbit-gateway-nas', NAS_STORY], ['rabbit-gateway-windows', WINDOWS_STORY]]) {
      const c = storyPage(id)
      const text = flat(c.textContent)
      let at = -1
      for (const st of story.steps) {
        for (const piece of [`${st.lead} ${st.text}`, ...(st.items || []).map((it) => `${it.lead} ${it.text}`)]) {
          const i = text.indexOf(flat(piece))
          expect(i, `${id}: ${piece.slice(0, 50)}`).toBeGreaterThan(at)
          at = i
        }
      }
      for (const a of story.after) expect(text, `${id}: ${a.lead}`).toContain(flat(`${a.lead} ${a.text}`))
      expect(text).toContain(story.intro)
      // The steps are a numbered list, as the card numbers them.
      expect(c.querySelectorAll('ol > li')).toHaveLength(story.steps.length)
      cleanup()
      expect(flat(storyPage(id, 'light').textContent)).toBe(text)
      cleanup()
    }
  })
  it('the card renders the same two objects (one text, two places), under the tab names the pages give', () => {
    const card = src('src/components/settings/GatewaySettings.jsx')
    expect(card).toContain('<Story story={tab === \'nas\' ? NAS_STORY : WINDOWS_STORY} locations={locations} />')
    expect(card).toMatch(/import \{[^}]*\bNAS_STORY, WINDOWS_STORY\b[^}]*\} from '\.\/gatewayWords'/)
    expect(flat(storyPage('rabbit-gateway-nas').textContent)).toContain('these same steps under On a NAS')
    cleanup()
    expect(flat(storyPage('rabbit-gateway-windows').textContent)).toContain('these same steps under On a Windows PC')
  })
  it('links the hardening guide, which is in the repository at that path, and says the switch and TPN as the design does', async () => {
    const { HARDENING_GUIDE_URL } = await import('../../components/settings/gatewayWords')
    expect(HARDENING_GUIDE_URL).toBe('https://github.com/pretty-aud/wilson/blob/main/WILSON/docs/gateway/HARDENING.md')
    for (const id of ['rabbit-gateway-nas', 'rabbit-gateway-windows']) {
      const a = [...storyPage(id).querySelectorAll('a')].find((x) => x.textContent === 'hardening guide')
      expect(a, id).toBeTruthy()
      expect(a.getAttribute('href')).toBe(HARDENING_GUIDE_URL)
      expect(a.getAttribute('target')).toBe('_blank')
      cleanup()
    }
    expect(src('docs/gateway/HARDENING.md')).toMatch(/^# The WILSON file gateway: the hardening guide/)
    expect(flat(storyPage('rabbit-gateway-nas').textContent)).toContain('Turning on viewing from outside the office is the moment a workspace leaves TPN Gold Shield eligibility; WILSON never sells the gateway as TPN-compliant.')
  })
})
