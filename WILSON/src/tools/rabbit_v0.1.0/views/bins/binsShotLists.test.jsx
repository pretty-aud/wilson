/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul S3c, step 1 — the Bins side of "links resolve, and say which
// list". `ctx.scenes` / `ctx.shots` are the ACTIVE shot list's (D10): a take
// on a shot only ANOTHER list holds dropped out of a file's "Used in shots",
// and a file logged to such a shot read an empty picker. BinsView now hands
// every row to the usage selectors and the pickers; the pickers offer the
// active list's rows with a switch for the rest; each shot names its list.
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import BinInspector from './BinInspector'
import AssignToShotDialog from './AssignToShotDialog'
import { usageByFile, usageCounts } from '../../bins/shotTakeSelectors'
import { homeIndex } from '../scenes/linkHomes'

afterEach(() => { cleanup() })
const here = dirname(fileURLToPath(import.meta.url))

const sceneA = { id: 'A', name: 'Harbour', scene_number: 1 }
const sceneB = { id: 'B', name: 'Lighthouse', scene_number: 2 }
const a1 = { id: 'a1', scene_id: 'A', name: 'SC001_SH010', shot_number: 10 }
const b1 = { id: 'b1', scene_id: 'B', name: 'SC002_SH010', shot_number: 10 }
const homeOf = homeIndex({
  shotLists: [{ id: 'L1', title: 'Shoot', version: 2 }, { id: 'L2', title: 'Pickups', version: 1 }],
  shotListItems: [
    { id: 'i1', shot_list_id: 'L1', scene_id: 'A' }, { id: 'i2', shot_list_id: 'L1', shot_id: 'a1' },
    { id: 'i3', shot_list_id: 'L2', scene_id: 'B' }, { id: 'i4', shot_list_id: 'L2', shot_id: 'b1' },
  ],
  shots: [a1, b1], edits: [], activeId: 'L1',
})
const file = { id: 'f1', bin_id: 'bin1', display_name: 'Clip', original_name: 'clip.mov', extension: '.mov', media_type: 'video', online: true, review_flag: 'unflagged', scene_id: 'B', shot_id: 'b1' }
const takes = [{ id: 'k1', shot_id: 'b1', bin_file_id: 'f1', role: 'primary', position: 0 }]

describe('the Bins usage selectors, handed every row (S3c step 1)', () => {
  it('a take on another list\'s shot is counted and placed; handed only the active list\'s shots (the old call) it was dropped', () => {
    expect(usageCounts(takes, [a1, b1]).get('f1')).toBe(1)
    expect(usageByFile(takes, [a1, b1], [sceneA, sceneB], [file]).get('f1')[0].shot.id).toBe('b1')
    // CONTROL: the old call.
    expect(usageCounts(takes, [a1]).get('f1')).toBeUndefined()
    expect(usageByFile(takes, [a1], [sceneA], [file]).get('f1')).toBeUndefined()
  })
  it('BinsView hands them every row', () => {
    const src = readFileSync(join(here, '../BinsView.jsx'), 'utf8')
    expect(src).toContain('usageByFile(shotTakes, allShots, allScenes, files)')
    expect(src).toContain('usageCounts(shotTakes, allShots)')
  })
})

describe('the inspector (S3c step 1)', () => {
  const inspector = (extra = {}) => render(
    <BinInspector rows={[file]} scenes={[sceneA]} shots={[a1]} allScenes={[sceneA, sceneB]} allShots={[a1, b1]} homeOf={homeOf}
      fps={24} canWrite ffmpeg={false} thumbUrlFor={() => null} streamUrlFor={() => null} onPatch={() => {}}
      usage={usageByFile(takes, [a1, b1], [sceneA, sceneB], [file])} onAssign={() => {}} onUnassign={() => {}} projectId="p1" {...extra} />,
  )
  it('"Used in shots" lists another list\'s shot, with its list beside its name', () => {
    inspector()
    const home = document.querySelector('.rb-scene-home')
    expect(home.getAttribute('title')).toBe('SC002_SH010\nIn: Pickups · v1')
    expect(home.querySelector('.rb-scene-home-label').textContent).toBe('Pickups · v1')
  })
  it('the logging pickers keep the scene and shot the file is logged to (another list\'s), and the switch offers every list\'s', () => {
    inspector()
    const selects = [...document.querySelectorAll('select')]
    const scene = selects.find(s => [...s.options].some(o => o.textContent === 'Harbour'))
    expect([...scene.options].map(o => o.textContent)).toEqual(['— none —', 'Harbour', 'Lighthouse'])
    expect(scene.value).toBe('B')
    const shot = selects.find(s => [...s.options].some(o => o.textContent === 'SC002_SH010'))
    expect(shot.value).toBe('b1')
    expect(screen.getByRole('switch', { name: 'Scenes and shots of all lists' })).toBeTruthy()
  })
  it('a file logged to the active list\'s rows offers only those until the switch is on', () => {
    render(
      <BinInspector rows={[{ ...file, scene_id: null, shot_id: null }]} scenes={[sceneA]} shots={[a1]} allScenes={[sceneA, sceneB]} allShots={[a1, b1]}
        fps={24} canWrite ffmpeg={false} thumbUrlFor={() => null} streamUrlFor={() => null} onPatch={() => {}} />,
    )
    const sceneSelect = () => [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === 'Harbour'))
    expect([...sceneSelect().options].map(o => o.textContent)).toEqual(['— none —', 'Harbour'])
    fireEvent.click(screen.getByRole('switch', { name: 'Scenes and shots of all lists' }))
    expect([...sceneSelect().options].map(o => o.textContent)).toEqual(['— none —', 'Harbour', 'Lighthouse'])
  })
  it('without the lists (no homeOf) the inspector prints no list words', () => {
    inspector({ homeOf: null })
    expect(document.querySelector('.rb-scene-home')).toBeNull()
  })
})

describe('Assign to shot… (S3c step 1)', () => {
  it('offers the active list\'s shots; "All lists" adds another list\'s; each names its list', () => {
    render(
      <AssignToShotDialog files={[file]} binFiles={[file]} scenes={[sceneA]} shots={[a1]} allScenes={[sceneA, sceneB]} allShots={[a1, b1]}
        homeOf={homeOf} shotTakes={[]} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={() => {}} busy={false} />,
    )
    const dialog = screen.getByRole('dialog')
    const names = () => [...dialog.querySelectorAll('.bn-pick-row')].map(r => r.textContent)
    expect(names().some(t => t.includes('SC001_SH010'))).toBe(true)
    expect(names().some(t => t.includes('SC002_SH010'))).toBe(false)
    fireEvent.click(within(dialog).getByRole('switch', { name: 'All lists' }))
    const other = [...dialog.querySelectorAll('.bn-pick-row')].find(r => r.textContent.includes('SC002_SH010'))
    expect(other).toBeTruthy()
    expect(other.querySelector('.rb-scene-home-label').textContent).toBe('Pickups · v1')
  })
  it('one list in the project: no switch', () => {
    render(
      <AssignToShotDialog files={[file]} binFiles={[file]} scenes={[sceneA]} shots={[a1]} allScenes={[sceneA]} allShots={[a1]}
        shotTakes={[]} thumbUrlFor={() => null} onConfirm={() => {}} onCancel={() => {}} busy={false} />,
    )
    expect(within(screen.getByRole('dialog')).queryByRole('switch')).toBeNull()
  })
})
