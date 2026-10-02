/** @vitest-environment jsdom */
// Post-overhaul S3c, step 1: LinkHome — a linked scene's or shot's shot list
// beside its name. What it prints, what its tooltip says, and what a screen
// reader is told instead of "+1".
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import LinkHome from './LinkHome'
import { homeIndex } from './linkHomes'

afterEach(() => { cleanup() })

const ctx = {
  shotLists: [{ id: 'L1', title: 'Shoot', version: 2 }, { id: 'L2', title: 'Pickups', version: 1 }],
  shotListItems: [{ id: 'i1', shot_list_id: 'L1', shot_id: 'x' }, { id: 'i2', shot_list_id: 'L2', shot_id: 'x' }],
  allShots: [{ id: 'x', scene_id: null, name: 'SC001_SH010' }],
  edits: [{ id: 'e1', shot_list_id: 'L1', title: 'Cut', version: 1, items: [{ id: 'n', shot_id: 'x' }] }],
  project: { active_shot_list_id: 'L1' },
}

describe('LinkHome', () => {
  it('prints the active list and "+N"; the tooltip names every list and edit; a screen reader hears the words, not "+2"', () => {
    const { container } = render(<LinkHome ctx={ctx} id="x" name="SC001_SH010" />)
    const root = container.querySelector('.rb-scene-home')
    expect(root.querySelector('.rb-scene-home-label').textContent).toBe('Shoot · v2')
    expect(root.querySelector('.rb-scene-home-more').textContent).toBe('+2')
    expect(root.getAttribute('title')).toBe('SC001_SH010\nIn: Shoot · v2 (active), Pickups · v1\nEdits: Cut · v1 (Shoot · v2)')
    expect(root.querySelector('.rb-scene-home-label').getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelector('.rb-scene-home-more').getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelector('.sr-only').textContent).toBe('In: Shoot · v2 (active), Pickups · v1. Edits: Cut · v1 (Shoot · v2)')
  })
  it('a row in no live list says so, with no "+N"', () => {
    const { container } = render(<LinkHome ctx={ctx} id="nobody" name="Gone" />)
    expect(container.querySelector('.rb-scene-home-label').textContent).toBe('In no shot list')
    expect(container.querySelector('.rb-scene-home-more')).toBeNull()
  })
  it('a table\'s own index (homeOf) is used instead of building one per row', () => {
    const homeOf = homeIndex({ shotLists: ctx.shotLists, shotListItems: ctx.shotListItems, shots: ctx.allShots, edits: [], activeId: 'L2' })
    const { container } = render(<LinkHome homeOf={homeOf} id="x" name="SC001_SH010" />)
    expect(container.querySelector('.rb-scene-home-label').textContent).toBe('Pickups · v1')
  })
})
