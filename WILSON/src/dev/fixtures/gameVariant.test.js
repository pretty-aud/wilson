// =============================================================================
// The `?fixtures=game` variant (B4, 2026-09-25): Salt Hours with levels and
// experiences switched on, so the Levels and Experiences views, their detail
// popups, the relations panel and its asset picker can be opened on the
// fixtures at all. The default dataset — what every other walk screen
// measures — must stay exactly as it was.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createStore, applyGameVariant, fixtureVariant } from './store'
import { GAME_LEVELS, GAME_EXPERIENCES, GAME_LINKS, LEVELS, EXPERIENCES } from './data/scenes'
import { PROJECT_ID } from './data/project'
import { fid } from './ids'

describe('the game variant', () => {
  it('leaves the default store untouched: flags off, no levels, no experiences, no asset links', () => {
    const store = createStore()
    expect(LEVELS).toEqual([])
    expect(EXPERIENCES).toEqual([])
    expect(store.projects[0].levels_enabled).toBe(false)
    expect(store.projects[0].experiences_enabled).toBe(false)
    expect(store.levels).toEqual([])
    expect(store.experiences).toEqual([])
    expect(store.assets.some(a => 'level_ids' in a || 'experience_ids' in a)).toBe(false)
  })

  it('switches both flags on and seeds four levels and three experiences on the project', () => {
    const store = applyGameVariant(createStore())
    expect(store.projects[0].levels_enabled).toBe(true)
    expect(store.projects[0].experiences_enabled).toBe(true)
    expect(store.levels).toHaveLength(4)
    expect(store.experiences).toHaveLength(3)
    for (const row of [...store.levels, ...store.experiences]) {
      expect(row.project_id).toBe(PROJECT_ID)
      expect(row.name.length).toBeGreaterThan(0)
      expect(row.start_date <= row.end_date).toBe(true)
    }
    const ids = [...store.levels, ...store.experiences].map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('links five assets, and every link resolves to a seeded row', () => {
    const store = applyGameVariant(createStore())
    const levelIds = new Set(GAME_LEVELS.map(l => l.id))
    const expIds = new Set(GAME_EXPERIENCES.map(x => x.id))
    const linked = store.assets.filter(a => a.level_ids || a.experience_ids)
    expect(linked.map(a => a.id)).toEqual(GAME_LINKS.map(([n]) => fid('asset', n)))
    for (const a of linked) {
      expect(a.level_ids.length).toBeGreaterThan(0)
      for (const id of a.level_ids) expect(levelIds.has(id)).toBe(true)
      for (const id of a.experience_ids) expect(expIds.has(id)).toBe(true)
    }
  })

  it('does not reach the shared data: a second default store after a variant is still clean', () => {
    applyGameVariant(createStore())
    const again = createStore()
    expect(again.projects[0].levels_enabled).toBe(false)
    expect(again.assets.some(a => 'level_ids' in a)).toBe(false)
  })

  it('reads the variant from the query string, and only the one value', () => {
    expect(fixtureVariant('?fixtures=game')).toBe('game')
    expect(fixtureVariant('?x=1&fixtures=game')).toBe('game')
    expect(fixtureVariant('')).toBe(null)
    expect(fixtureVariant('?fixtures=other')).toBe(null)
    expect(fixtureVariant('?fixtures=')).toBe(null)
  })
})
