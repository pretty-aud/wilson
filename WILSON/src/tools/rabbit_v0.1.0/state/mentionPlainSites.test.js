// MO3 (PLAN_MOTH S3, step 1's inventory): a typed link's code is never shown, searched or sent outside the windows that
// draw it. The custom views filter on the words, the bins' shot search finds the words and never the key, the edit
// history shows the words, and D.O.G. reads a thing's words as its reader sees them, as it reads a note's.
import { describe, it, expect } from 'vitest'
import { scenesDescription, shotsDescription } from '../views/tableViews/scenesTableView'
import { assetsDescription } from '../views/tableViews/assetsTableView'
import { matchesShotSearch } from '../bins/shotTakeSelectors'
import { diffLines } from '../components/editHistoryFormat'
import { itemWords } from '../../deck-outline-generator_v0.514/references/referenceModel'

const TEXT = 'Light [[the lighthouse|m:a1b2c3d4e5f6]] at dawn'
const WORDS = 'Light the lighthouse at dawn'

describe("a link's code, outside the windows that draw it", () => {
  it('the custom views filter on the words', () => {
    expect(scenesDescription().valuesOf({ description: TEXT }, 'description')).toEqual([WORDS])
    expect(shotsDescription().valuesOf({ description: TEXT }, 'description')).toEqual([WORDS])
    expect(assetsDescription().valuesOf({ description: TEXT }, 'description')).toEqual([WORDS])
  })

  it("the bins' shot search finds the words and never the key", () => {
    const shot = { name: 'The door', description: TEXT }
    expect(matchesShotSearch(shot, null, 'lighthouse')).toBe(true)
    expect(matchesShotSearch(shot, null, 'a1b2c3')).toBe(false)
  })

  it('the edit history shows the words', () => {
    const lines = diffLines({ action: 'update', diff: { description: { old: TEXT, new: 'Dusk' } } })
    expect(lines[0]).toMatchObject({ field: 'description', from: WORDS, to: 'Dusk' })
  })

  it("D.O.G. reads a scene's words as its reader sees them, and a status as words still", () => {
    const out = itemWords({ kind: 'scene', name: 'Lighthouse', row: { description: TEXT, notes: TEXT, time_of_day: 'golden_hour' } }, {})
    expect(out).toContain(`Description: ${WORDS}`)
    expect(out).toContain(`Notes: ${WORDS}`)
    expect(out).toContain('Time of day: Golden hour')
    expect(out).not.toMatch(/m:a1b2/)
  })
})
