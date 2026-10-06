/** @vitest-environment jsdom */
// =============================================================================
// rabbitVersionsHelp.test.jsx — post-overhaul S5d, step 9: the "Budget" and
// "Timeline" help pages say what bid versions are in the screens' OWN words —
// the three states, the two save verbs, Edit this version and what it sets
// aside and brings back, viewing against editing, production, that Undo on
// the Budget is the toast, and that leaving asks nothing on purpose — so a
// rename on a screen, or a changed rule, reaches Help or fails here. The
// token, ink and sentence-case rules every help page keeps are
// helpContent.test.jsx's (it walks every page, these included).
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))

const { RabbitHelpContent } = await import('./rabbitHelpContent')
const { LOCKED_WHY } = await import('./views/budget/BidVersions')

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, p), 'utf8').replace(/\r\n/g, '\n')
const page = (id, theme = 'dark') => render(<RabbitHelpContent helpPage={id} theme={theme} />).container.textContent.replace(/\s+/g, ' ')

describe('the "Budget" help page: bid versions (S5d, step 9)', () => {
  it('names the three states in one table, each as the screens say it', () => {
    const { container } = render(<RabbitHelpContent helpPage="rabbit-budget" theme="dark" />)
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td').textContent)
    expect(rows).toEqual(['Open', 'Selected', 'Locked'])
    const text = page('rabbit-budget')
    expect(text).toContain('Save writes your changes back into it')
    expect(text).toContain('Choose it in Selected bid')
    // The Summary's own control is called that.
    expect(read('./views/budget/BidVersions.jsx')).toContain('<span className="ui-field-label">Selected bid</span>')
  })
  it('says the two save verbs, Edit this version and what it sets aside and brings back — nothing lost', () => {
    const text = page('rabbit-budget')
    expect(text).toContain('Save writes the changes into the open version: Mid ROM stays Mid ROM.')
    expect(text).toContain('Save as new version… is the only way a new version appears. It asks for a name')
    expect(text).toContain('leave the Timeline, kept whole with their comments, files and logged time, and come back when you edit a version that holds them: nothing is lost.')
    expect(text).toContain('Cancel, Discard changes, or Save to it.')
  })
  it('says viewing against editing, and production with the lock\'s own sentence', () => {
    const text = page('rabbit-budget')
    expect(text).toContain('the Bid version dropdown shows any saved version read-only: nothing is written')
    expect(text).toContain(LOCKED_WHY)
    expect(text).toContain('records a copy of it (for example "Revision after week 2") without opening or selecting it')
  })
  it('says Undo on the Budget is the toast, and that leaving asks nothing — on purpose', () => {
    const text = page('rabbit-budget')
    expect(text).toContain('The Budget has no Ctrl+Z for these steps.')
    expect(text).toContain('offers Undo in the toast at the bottom')
    expect(text).toContain('asks nothing, on purpose: nothing is lost.')
  })
  it('names the verbs as the buttons are labelled, on both pages that have them', () => {
    const bar = read('./views/TimelineVersions.jsx')
    const block = read('./views/budget/BidVersions.jsx')
    for (const verb of ['Save as new version…', 'Edit this version']) {
      expect(page('rabbit-budget'), verb).toContain(verb)
      expect(bar, `the Timeline's bar no longer says "${verb}"`).toMatch(new RegExp(`>\\s*${verb}\\s*<`))
      expect(block, `the Summary no longer says "${verb}"`).toMatch(new RegExp(`>\\s*${verb}\\s*<`))
    }
  })
  it('draws on both surfaces (the Help page is light, the tool\'s dialog dark)', () => {
    expect(page('rabbit-budget', 'light')).toBe(page('rabbit-budget', 'dark'))
  })
})

describe('the "Timeline" help page: the bid version bar (S5d, step 9)', () => {
  it('names the bar, its dropdown\'s entries and its verbs as the bar draws them', () => {
    const text = page('rabbit-timeline')
    const bar = read('./views/TimelineVersions.jsx')
    expect(text).toContain('For project managers and workspace admins, a Bid version bar sits under the zoom toolbar.')
    expect(bar).toContain('<span className="ui-field-label">Bid version</span>')
    for (const word of ['Current', 'Manage versions…', 'Edit this version']) {
      expect(text, word).toContain(word)
      expect(bar, word).toContain(word)
    }
    expect(text).toContain('the bar says Viewing bid version')
    expect(bar).toContain("{'Viewing bid version: '}")
  })
  it('says a view is read-only and a look, Save into the open version, and the lock greying the dropdown with the Timeline still editable', () => {
    const text = page('rabbit-timeline')
    expect(text).toContain('view its schedule read-only')
    expect(text).toContain('nothing can be dragged or created, Undo waits, and leaving the tab comes back to Current.')
    expect(text).toContain('Save writes your changes into it.')
    expect(text).toContain('the dropdown is greyed with the reason; the Timeline stays editable, and Save as new version… records a copy.')
  })
  it('CONTROL: a page that is not there draws the fallback, not these words', () => {
    expect(page('rabbit-budgett')).toMatch(/Pick a topic/)
    expect(page('rabbit-budgett')).not.toContain('Bid versions')
  })
})
