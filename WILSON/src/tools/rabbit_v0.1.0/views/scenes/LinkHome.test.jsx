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

  // Audrey's rule of 2026-10-02: the task popup says when the active list does
  // not hold the link — what that does to the Timeline and the Budget.
  describe('outside the active list', () => {
    const NOTE = 'Not in the active list, so the Timeline and the Budget show its tasks as not assigned until it is in the active list again.'
    it('", not in the active list" after the list, kept whole; the tooltip and a screen reader say what it does', () => {
      const homeOf = homeIndex({ shotLists: ctx.shotLists, shotListItems: [{ id: 'i2', shot_list_id: 'L2', shot_id: 'x' }], shots: ctx.allShots, edits: [], activeId: 'L1' })
      const { container } = render(<LinkHome homeOf={homeOf} id="x" name="SC001_SH010" outside />)
      const root = container.querySelector('.rb-scene-home')
      expect(root.getAttribute('data-outside')).toBe('true')
      expect(root.textContent.replace(root.querySelector('.sr-only').textContent, '')).toBe('Pickups · v1, not in the active list')
      expect(root.querySelector('.rb-scene-home-outside').getAttribute('aria-hidden')).toBe('true')
      expect(root.getAttribute('title')).toBe(`SC001_SH010\nIn: Pickups · v1\n${NOTE}`)
      expect(root.querySelector('.sr-only').textContent).toBe(`In: Pickups · v1. ${NOTE}`)
    })
    it('in no shot list: the label already says it; only the tooltip adds what it does', () => {
      const { container } = render(<LinkHome ctx={ctx} id="nobody" name="Gone" outside />)
      expect(container.querySelector('.rb-scene-home-label').textContent).toBe('In no shot list')
      expect(container.querySelector('.rb-scene-home-outside')).toBeNull()
      expect(container.querySelector('.rb-scene-home').getAttribute('title')).toBe(`Gone\nIn no shot list\n${NOTE}`)
    })
    it('not outside: nothing added', () => {
      const { container } = render(<LinkHome ctx={ctx} id="x" name="SC001_SH010" />)
      expect(container.querySelector('.rb-scene-home').getAttribute('data-outside')).toBeNull()
      expect(container.querySelector('.rb-scene-home').getAttribute('title')).not.toContain('Not in the active list')
    })
  })
})
