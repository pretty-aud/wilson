/** @vitest-environment jsdom */
// =============================================================================
// rabbitNoMainHelp.test.jsx — VW1m (2026-10-16): the help says what "no main
// item" means, in the screens' own words. Audrey: "lets not have main asset
// be a thing. thats not needed and i dont like." The Assets page says a task
// can be about several assets, scenes and shots (it said a task was "tagged
// with an asset id"), and that deleting an asset leaves its tasks (her Q-M2);
// the Timeline page says how a task about two assets is drawn (her batch 12:
// one row named for both); the Budget page says the even split (her Q-M1:
// "Split between its assets"). The token, ink and sentence-case rules every
// help page keeps are helpContent.test.jsx's (it walks these pages too).
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))

const { RabbitHelpContent } = await import('./rabbitHelpContent')

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, p), 'utf8').replace(/\r\n/g, '\n')
const page = (id, theme = 'dark') => render(<RabbitHelpContent helpPage={id} theme={theme} />).container.textContent.replace(/\s+/g, ' ')

describe('the "Assets" help page: a task\'s items are its items (VW1m)', () => {
  it('says a task can be about several assets, scenes and shots, where they are added, and that deleting an asset leaves its tasks', () => {
    const text = page('rabbit-assets')
    expect(text).toContain('A task can be about several assets, scenes and shots at once: add them in the task\'s window, under Items.')
    expect(text).toContain('Deleting an asset never deletes a task: the asset comes off its tasks, which stay.')
  })
  it('CONTROL: the old one-asset sentence is gone, and no page of the help says "main"', () => {
    expect(page('rabbit-assets')).not.toMatch(/tagged with an asset id/)
    for (const id of ['rabbit-assets', 'rabbit-timeline', 'rabbit-budget']) expect(page(id), id).not.toMatch(/\bmain (asset|item|scene|shot)\b/i)
  })
  it('names the window\'s Items table as the table draws it', () => {
    expect(read('./components/RelationsPanel.jsx')).toContain('title={`Items (${live.length})`}')
  })
})

describe('the "Timeline" help page: a task about two assets sits in one row (VW1m)', () => {
  it('says the combination row, where it sits, and No asset last', () => {
    const text = page('rabbit-timeline')
    expect(text).toContain('A task about two assets sits in one row named for both, as in Lighthouse Interior, Storm Lantern, after the rows of single assets; a task with none sits under No asset, last.')
    expect(text).toContain('Scenes, shots, levels and experiences group the same way.')
  })
  it('the words "No asset" are the model\'s, the ones the rows and groups draw', () => {
    expect(read('./state/taskItemsModel.js')).toMatch(/asset: 'No asset'/)
  })
})

describe('the "Budget" help page: a task about several assets is split evenly (VW1m)', () => {
  it('says the even split, the other tabs that split the same way, and that every tab adds up', () => {
    const text = page('rabbit-budget')
    expect(text).toContain('A task about several assets is split evenly between them in By asset: half its days and money to each of two assets, a third to each of three.')
    expect(text).toContain('By scene, By shot, By level and By experience split the same way, and a task with none sits under No asset, so every tab adds up to the project\'s total.')
  })
  it('names the tabs as the Budget labels them', () => {
    const budget = read('./views/BudgetView.jsx')
    for (const tab of ['By asset', 'By scene', 'By shot', 'By level', 'By experience']) {
      expect(page('rabbit-budget'), tab).toContain(tab)
      expect(budget, `the Budget no longer says "${tab}"`).toContain(`label: '${tab}'`)
    }
  })
  it('draws on both surfaces (the Help page is light, the tool\'s dialog dark)', () => {
    for (const id of ['rabbit-assets', 'rabbit-timeline', 'rabbit-budget']) expect(page(id, 'light'), id).toBe(page(id, 'dark'))
  })
})
