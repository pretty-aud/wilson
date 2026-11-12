// boardPanelState.test.js — MO4: the board panel's pure rules (sizes, the pull distance that closes, corner against
// edge hits, the corner resize, the Escape stack, the words).
import { describe, it, expect, vi } from 'vitest'
import {
  SIZES, normalizeSize, canPullAway, canResize, PULL_CLOSE_PX, PULL_SHRINK, MIN_FRAME, FALLBACK_BOUNDS, EDGE_BAND_PX,
  CORNER_PX, TOUCH_EDGE_BAND_PX, hitSizes, boundsFrom, defaultFrame, clampFrame, hitZone, isCorner, isEdge, cursorFor,
  pullDistance, pullScale, pullCloses, resizeFrame, collapseTransform, createEscapeStack, boardWords, BOARD_NEEDS_CLOUD,
  TRASH_WORDS, trashWords, whoKey, PET_REACH_PX,
} from './boardPanelState.js'

const R = { x: 100, y: 50, w: 600, h: 400 }

describe('the sizes', () => {
  it('three, and anything else is the frame', () => {
    expect(SIZES).toEqual(['framed', 'filled', 'maximised'])
    expect(normalizeSize('filled')).toBe('filled')
    expect(normalizeSize('huge')).toBe('framed')
    expect(normalizeSize(undefined)).toBe('framed')
  })
  it('🚨 only the frame pulls away and resizes', () => {
    expect(canPullAway('framed')).toBe(true)
    expect(canResize('framed')).toBe(true)
    for (const s of ['filled', 'maximised']) {
      expect(canPullAway(s)).toBe(false)
      expect(canResize(s)).toBe(false)
    }
  })
})

describe('the frame in its space', () => {
  it('opens centred, with the map showing round it', () => {
    const f = defaultFrame({ w: 1000, h: 700 })
    expect(f.x).toBeGreaterThan(0)
    expect(f.y).toBeGreaterThan(0)
    expect(f.x * 2 + f.w).toBe(1000)
    expect(f.y * 2 + f.h).toBe(700)
  })
  it('opens clear of the pet in the page\'s bottom right corner, so that corner can be taken hold of', () => {
    for (const w of [1440, 1280, 1920]) {
      const f = defaultFrame({ w, h: 749 })
      expect(w - (f.x + f.w)).toBeGreaterThan(PET_REACH_PX)
    }
  })
  it('a small space gives at least the least frame, and never more than the space', () => {
    expect(defaultFrame({ w: 400, h: 300 })).toEqual({ x: 20, y: 30, w: MIN_FRAME.w, h: MIN_FRAME.h })
    const tiny = defaultFrame({ w: 200, h: 100 })
    expect(tiny.w).toBe(200)
    expect(tiny.h).toBe(100)
  })
  it('nothing measured is the fallback', () => {
    expect(boundsFrom({ width: 0, height: 0 })).toEqual(FALLBACK_BOUNDS)
    expect(boundsFrom(null)).toEqual(FALLBACK_BOUNDS)
    expect(boundsFrom({ width: 800, height: 500 })).toEqual({ w: 800, h: 500 })
  })
  it('a frame is kept inside a space that shrank', () => {
    expect(clampFrame({ x: 700, y: 500, w: 600, h: 400 }, { w: 1000, h: 700 })).toEqual({ x: 400, y: 300, w: 600, h: 400 })
    expect(clampFrame({ x: -20, y: 10, w: 100, h: 100 }, { w: 1000, h: 700 })).toEqual({ x: 0, y: 10, w: MIN_FRAME.w, h: MIN_FRAME.h })
  })
})

describe('🚨 corner against edge', () => {
  it('a press near two edges, within the band, is a corner', () => {
    expect(hitZone(R, 102, 52)).toBe('nw')
    expect(hitZone(R, 698, 52)).toBe('ne')
    expect(hitZone(R, 102, 448)).toBe('sw')
    expect(hitZone(R, 698, 448)).toBe('se')
    // Along the band, still within the corner's reach.
    expect(hitZone(R, 100 + CORNER_PX - 1, 52)).toBe('nw')
  })
  it('a press near one edge is that edge', () => {
    expect(hitZone(R, 400, 52)).toBe('n')
    expect(hitZone(R, 400, 448)).toBe('s')
    expect(hitZone(R, 102, 250)).toBe('w')
    expect(hitZone(R, 698, 250)).toBe('e')
    expect(hitZone(R, 100 + CORNER_PX + 1, 52)).toBe('n')
  })
  it('inside the band is the board\'s, and outside the frame is nothing', () => {
    expect(hitZone(R, 400, 250)).toBeNull()
    // Near a corner but past the band: inside.
    expect(hitZone(R, 100 + EDGE_BAND_PX + 5, 50 + EDGE_BAND_PX + 5)).toBeNull()
    expect(hitZone(R, 99, 250)).toBeNull()
    expect(hitZone(R, 400, 451)).toBeNull()
    expect(hitZone(null, 1, 1)).toBeNull()
  })
  it('a finger or a pen gets a wider band', () => {
    expect(hitSizes('touch').band).toBe(TOUCH_EDGE_BAND_PX)
    expect(hitSizes('pen').band).toBe(TOUCH_EDGE_BAND_PX)
    expect(hitSizes('mouse').band).toBe(EDGE_BAND_PX)
    const at = 100 + EDGE_BAND_PX + 4
    expect(hitZone(R, at, 250)).toBeNull()
    expect(hitZone(R, at, 250, hitSizes('touch'))).toBe('w')
  })
  it('names and cursors', () => {
    expect(isCorner('se')).toBe(true)
    expect(isCorner('s')).toBe(false)
    expect(isEdge('w')).toBe(true)
    expect(isEdge('nw')).toBe(false)
    expect(cursorFor('nw')).toBe('nwse-resize')
    expect(cursorFor('ne')).toBe('nesw-resize')
    expect(cursorFor('n')).toBe('grab')
    expect(cursorFor(null)).toBe('')
  })
})

describe('🚨 the pull distance that closes', () => {
  it('counts outward only, along the edge', () => {
    expect(pullDistance('n', { x: 0, y: 100 }, { x: 30, y: 40 })).toBe(60)
    expect(pullDistance('n', { x: 0, y: 100 }, { x: 0, y: 140 })).toBe(0)
    expect(pullDistance('s', { x: 0, y: 100 }, { x: 0, y: 150 })).toBe(50)
    expect(pullDistance('w', { x: 100, y: 0 }, { x: 20, y: 0 })).toBe(80)
    expect(pullDistance('e', { x: 100, y: 0 }, { x: 90, y: 0 })).toBe(0)
    expect(pullDistance('nw', { x: 0, y: 0 }, { x: -50, y: -50 })).toBe(0)
  })
  it('the frame shrinks as it is pulled, and no more past the distance', () => {
    expect(pullScale(0)).toBe(1)
    expect(pullScale(PULL_CLOSE_PX / 2)).toBeCloseTo(1 - PULL_SHRINK / 2)
    expect(pullScale(PULL_CLOSE_PX)).toBeCloseTo(1 - PULL_SHRINK)
    expect(pullScale(PULL_CLOSE_PX * 3)).toBeCloseTo(1 - PULL_SHRINK)
    expect(pullScale(40)).toBeLessThan(pullScale(20))
  })
  it('closes at the distance, springs back short of it', () => {
    expect(pullCloses(PULL_CLOSE_PX - 1)).toBe(false)
    expect(pullCloses(PULL_CLOSE_PX)).toBe(true)
    expect(pullCloses(NaN)).toBe(false)
  })
})

describe('🚨 a corner resizes', () => {
  const space = { w: 1000, h: 700 }
  it('the two edges it joins move', () => {
    expect(resizeFrame(R, 'se', 50, 20, space)).toEqual({ x: 100, y: 50, w: 650, h: 420 })
    expect(resizeFrame(R, 'nw', -40, -30, space)).toEqual({ x: 60, y: 20, w: 640, h: 430 })
    expect(resizeFrame(R, 'ne', 30, 10, space)).toEqual({ x: 100, y: 60, w: 630, h: 390 })
    expect(resizeFrame(R, 'sw', 10, -10, space)).toEqual({ x: 110, y: 50, w: 590, h: 390 })
  })
  it('never smaller than the least, the far edges staying put', () => {
    const f = resizeFrame(R, 'nw', 1000, 1000, space)
    expect(f).toEqual({ x: 700 - MIN_FRAME.w, y: 450 - MIN_FRAME.h, w: MIN_FRAME.w, h: MIN_FRAME.h })
  })
  it('never past the space', () => {
    expect(resizeFrame(R, 'se', 5000, 5000, space)).toEqual({ x: 100, y: 50, w: 900, h: 650 })
    expect(resizeFrame(R, 'nw', -5000, -5000, space)).toEqual({ x: 0, y: 0, w: 700, h: 450 })
  })
  it('an edge is no corner', () => {
    expect(resizeFrame(R, 'n', 10, 10, space)).toBe(R)
  })
})

describe('collapsing into its dot', () => {
  it('moves the frame\'s centre to the dot as it shrinks', () => {
    expect(collapseTransform(R, { x: 50, y: 60 })).toBe('translate(-350px, -190px) scale(0.04)')
    expect(collapseTransform(R, null)).toBe('scale(0.04)')
  })
})

describe('🚨 the Escape stack', () => {
  it('asks the newest first, and one that takes the key stops it', () => {
    const s = createEscapeStack()
    const older = vi.fn(() => true)
    const newer = vi.fn(() => true)
    s.push(older)
    s.push(newer)
    expect(s.handle({})).toBe(true)
    expect(newer).toHaveBeenCalledTimes(1)
    expect(older).not.toHaveBeenCalled()
  })
  it('one that does not take it hands it down', () => {
    const s = createEscapeStack()
    const older = vi.fn(() => true)
    const newer = vi.fn(() => false)
    s.push(older)
    s.push(newer)
    expect(s.handle({})).toBe(true)
    expect(older).toHaveBeenCalledTimes(1)
  })
  it('popped, a handler is asked no more; nothing left is not taken', () => {
    const s = createEscapeStack()
    const h = vi.fn(() => true)
    const pop = s.push(h)
    pop()
    pop()
    expect(s.size()).toBe(0)
    expect(s.handle({})).toBe(false)
    expect(h).not.toHaveBeenCalled()
  })
  it('a handler that pops itself as it answers skips no other', () => {
    const s = createEscapeStack()
    const older = vi.fn(() => true)
    s.push(older)
    let pop = null
    pop = s.push(() => { pop(); return false })
    expect(s.handle({})).toBe(true)
    expect(older).toHaveBeenCalledTimes(1)
    expect(s.size()).toBe(1)
  })
  it('a handler that throws took nothing', () => {
    const s = createEscapeStack()
    s.push(() => { throw new Error('x') })
    expect(s.handle({})).toBe(false)
  })
})

describe('the words', () => {
  it('this computer says it needs the cloud', () => {
    expect(boardWords({ code: 'boards_absent', message: '' })).toBe(BOARD_NEEDS_CLOUD)
    expect(boardWords({ code: 'boards_absent', message: 'Boards need this project in the cloud.' })).toBe('Boards need this project in the cloud.')
  })
  it('missing and not allowed are one refusal, said plainly', () => {
    expect(boardWords({ code: '42501', message: 'board not found' })).toBe('This board is not there any more, or you may not open it.')
    expect(boardWords({ code: '42501', message: 'folder not found or not writable' }, { making: true })).toMatch(/^You cannot make a board here/)
  })
  it('the server\'s own words when they are words', () => {
    expect(boardWords({ code: '54000', message: 'A project holds at most 500 boards.' }, { making: true })).toBe('A project holds at most 500 boards.')
    expect(boardWords(new Error(''))).toBe('The board could not be opened just now.')
    expect(boardWords(null, { making: true })).toBe('The board could not be made just now.')
  })
})

describe('a board to the trash: the words', () => {
  it('asks in plain words, with the two answers', () => {
    expect(TRASH_WORDS.question).toBe('Put this board in the trash? Its notes and pictures go with it. You can bring it back from Moth\'s trash for 30 days.')
    expect(TRASH_WORDS.yes).toBe('Put it in the trash')
    expect(TRASH_WORDS.no).toBe('Keep it')
    expect(TRASH_WORDS.action).toBe('Put in the trash')
  })
  it('a refusal is the server\'s own words, an adapter\'s name before them left off', () => {
    expect(trashWords({ code: '54000', message: '[supabase] More than 10,000 files would go at once.' })).toBe('More than 10,000 files would go at once.')
    expect(trashWords({ code: '22023', message: 'A folder holding files on the office server cannot go to the trash yet.' }))
      .toBe('A folder holding files on the office server cannot go to the trash yet.')
    expect(trashWords({ code: '42501', message: 'Something in this folder is in the trash: bring it back or wait for it to go first.' }))
      .toBe('Something in this folder is in the trash: bring it back or wait for it to go first.')
    expect(trashWords({ code: 'P0001', message: 'moth_trash:x', details: 'Words from the server.' })).toBe('Words from the server.')
  })
  it('the one refusal for missing and not allowed, and nothing said at all, in plain words', () => {
    expect(trashWords({ code: '42501', message: '[supabase] folder not found or not writable' })).toBe(TRASH_WORDS.gone)
    expect(trashWords({ code: '42501', message: '' })).toBe(TRASH_WORDS.gone)
    expect(trashWords(new Error(''))).toBe(TRASH_WORDS.failed)
    expect(trashWords(null)).toBe(TRASH_WORDS.failed)
    expect(trashWords({ code: 'boards_absent', message: '' })).toBe(BOARD_NEEDS_CLOUD)
  })
})

describe('who the panel is open for', () => {
  it('the person and the company; a name is no part of it', () => {
    expect(whoKey({ id: 'u1', label: 'Mara Okonkwo' }, 'w1')).toBe(whoKey({ id: 'u1', label: 'Someone' }, 'w1'))
    expect(whoKey({ id: 'u1' }, 'w1')).not.toBe(whoKey({ id: 'u2' }, 'w1'))
    expect(whoKey({ id: 'u1' }, 'w1')).not.toBe(whoKey({ id: 'u1' }, 'w2'))
    expect(whoKey({ id: 'u1' }, 'w1')).not.toBe(whoKey({ id: null }, 'w1'))
    expect(whoKey(null, null)).toBe('|')
  })
})
