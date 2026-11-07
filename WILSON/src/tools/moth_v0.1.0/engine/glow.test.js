// =============================================================================
// glow.test.js — the light at the centre of M.O.T.H.'s world (MO2a, the brief's
// item 4; MOTH_PLANNING_BRIEF.md §1.1). Pins: the glow's size and brightness
// follow the WHOLE project (catalogueSize of the catalogue), so opening
// folders, focusing dots or hiding kinds never changes it or repaints it; it
// is centred on the viewport and grows monotonically from no light (0),
// through a faint first flicker (one or two things), to a sun (5,000+); its
// colour is a parameter with a safe fallback; calm mode stills it; light mode
// keeps white labels readable; the shadow is continuous and fades to 0; and
// mountGlow paints once per change of inputs and runs its motion as Web
// Animations, adjusted in place, paused, cancelled. Each rule has a PLANTED
// control: the same check run on a broken stand-in must fail.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { glowParams, shadowAlpha, mountGlow, DEFAULT_GLOW_COLOR } from './glow.js'
import { catalogueSize, buildGraph, nodeId } from './model.js'
import { generateCatalogue } from './fixtures.js'

const VP = { width: 1280, height: 800 }
const BG = [11, 11, 16] // #0b0b10, the night behind the light

// ── colour and contrast ─────────────────────────────────────────────────────
const rgbaOf = (s) => {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(s)
  return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] }
}
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
/** White text over one gradient stop composited on the night (WCAG ratio). */
const whiteOver = (stop) => {
  const { rgb, a } = rgbaOf(stop.color)
  return 1.05 / (luminance(rgb.map((v, i) => v * a + BG[i] * (1 - a))) + 0.05)
}

// ── a fake glow <canvas>: a recording 2D context and Web Animations ─────────
function fakeCanvas({ withEffect = true } = {}) {
  const log = []
  const ctx = {
    fillStyle: null,
    setTransform: (...a) => log.push(['setTransform', ...a]),
    clearRect: (...a) => log.push(['clearRect', ...a]),
    fillRect: (...a) => log.push(['fillRect', ctx.fillStyle, ...a]),
    createRadialGradient: (...args) => {
      const g = { args, stops: [], addColorStop: (at, color) => g.stops.push({ at, color }) }
      log.push(['gradient', g])
      return g
    },
  }
  const anims = []
  const el = {
    width: 300, height: 150,
    getContext: (kind) => (kind === '2d' ? ctx : null),
    animate: vi.fn((keyframes, options) => {
      const a = { keyframes, options, state: 'running' }
      a.cancel = vi.fn(() => { a.state = 'idle' })
      a.pause = vi.fn(() => { a.state = 'paused' })
      a.play = vi.fn(() => { a.state = 'running' })
      if (withEffect) a.effect = { setKeyframes: vi.fn((k) => { a.keyframes = k }), updateTiming: vi.fn((t) => { a.options = { ...a.options, ...t } }) }
      anims.push(a)
      return a
    }),
  }
  return { el, log, anims }
}
const calls = (log, kind) => log.filter((c) => c[0] === kind)
const live = (anims) => anims.filter((a) => a.state !== 'idle')
const driftOf = (anims) => live(anims).find((a) => 'filter' in a.keyframes[0])
const flickerOf = (anims) => live(anims).find((a) => 'opacity' in a.keyframes[0])

// ── the catalogue and the ways to navigate it ───────────────────────────────
const CAT = generateCatalogue({ seed: 11, projects: 3, foldersPerProject: 8, filesPerProject: 30, relations: 12 })
const BIG = generateCatalogue({ seed: 5, projects: 5, foldersPerProject: 10, filesPerProject: 1000 })
function views(cat) {
  const pid = cat.islands[0].id
  const folder = cat.folders[pid].find((f) => f.kind !== 'root')
  return [
    {}, // everything closed
    { expanded: [nodeId('project', pid)] },
    { expanded: [nodeId('project', pid), nodeId('folder', folder.id)] },
    { expanded: 'all' },
    { expanded: 'all', focus: { id: nodeId('file', cat.files[pid][0].id), depth: 1 } },
    { expanded: [nodeId('project', pid)], focus: { id: nodeId('project', pid), depth: 2 } },
    { expanded: 'all', nodeKinds: ['project', 'folder'] },
    { expanded: 'all', nodeKinds: ['project', 'file'], edgeKinds: ['lives_in'] },
  ]
}
const wholeProject = (cat) => catalogueSize(cat)
const inView = (cat, view) => buildGraph(cat, view).nodes.length // the planted fault

/** Walk every view with a sizer: how many different lights, how many repaints. */
function navigate(sizeOf, cat) {
  const { el } = fakeCanvas()
  const glow = mountGlow(el)
  const seen = new Set()
  for (const view of views(cat)) {
    const params = glowParams({ size: sizeOf(cat, view) })
    seen.add(JSON.stringify(params))
    glow.update(params, VP)
  }
  return { distinct: seen.size, paints: glow.paints() }
}
const followsProject = (sizeOf) => glowParams({ size: sizeOf(CAT, {}) }).intensity < glowParams({ size: sizeOf(BIG, {}) }).intensity

describe('the glow follows the whole project, never the view', () => {
  it('catalogueSize counts every project, folder and file given (not the root rows, not tags)', () => {
    expect(catalogueSize(CAT)).toBe(3 + 3 * 8 + 3 * 30)
    expect(catalogueSize(BIG)).toBe(5 + 5 * 10 + 5 * 1000)
  })

  it('opening folders, focusing dots and hiding kinds give one light and one paint', () => {
    expect(navigate(wholeProject, CAT)).toEqual({ distinct: 1, paints: 1 })
    expect(followsProject(wholeProject)).toBe(true)
  })

  it('CONTROL: sizing from buildGraph(view).nodes.length changes the light on navigation; a constant never grows', () => {
    expect(new Set(views(CAT).map((v) => inView(CAT, v))).size).toBeGreaterThanOrEqual(3) // the views really differ
    const r = navigate(inView, CAT)
    expect(r.distinct).toBeGreaterThan(1)
    expect(r.paints).toBeGreaterThan(1)
    expect(navigate(() => 42, CAT)).toEqual({ distinct: 1, paints: 1 }) // blind to navigation …
    expect(followsProject(() => 42)).toBe(false) // … but caught here
  })
})

describe('glowParams: shape of the light', () => {
  function centredAndSymmetric(alpha, glow, vp = VP) {
    const cx = vp.width / 2
    const cy = vp.height / 2
    const peak = alpha(cx, cy, glow, vp)
    if (!(peak > 0)) return false
    for (const [dx, dy] of [[37, 0], [0, 53], [101, -71], [-230, 140], [600, 390]]) {
      const a = alpha(cx + dx, cy + dy, glow, vp)
      if (a > peak) return false
      for (const [sx, sy] of [[-1, 1], [1, -1], [-1, -1]]) if (Math.abs(alpha(cx + sx * dx, cy + sy * dy, glow, vp) - a) > 1e-12) return false
    }
    return true
  }
  const cornerAnchored = (sx, sy, g, vp) => shadowAlpha(sx + vp.width / 2, sy + vp.height / 2, g, vp)

  it('is centred on the viewport: shadow peaks at the centre, symmetric; the gradient is painted there', () => {
    for (const size of [12, 117, 5000]) expect(centredAndSymmetric(shadowAlpha, glowParams({ size }))).toBe(true)
    const { el, log } = fakeCanvas()
    const g = glowParams({ size: 117 })
    mountGlow(el).update(g, VP, 2)
    expect(calls(log, 'gradient')[0][1].args).toEqual([1280, 800, 0, 1280, 800, g.radiusFrac * 1600])
  })

  it('CONTROL: a shadow anchored on the canvas corner fails the centring check', () => {
    expect(centredAndSymmetric(cornerAnchored, glowParams({ size: 5000 }))).toBe(false)
  })

  const growsMonotonically = (params) => {
    let prev = params(0)
    for (let n = 1; n <= 6000; n++) {
      const g = params(n)
      if (g.intensity < prev.intensity || g.radiusFrac < prev.radiusFrac) return false
      prev = g
    }
    return params(5000).intensity > params(100).intensity && params(100).intensity > params(1).intensity &&
      params(5000).radiusFrac > params(1).radiusFrac
  }

  it('intensity and radius grow monotonically with the size of the project', () => {
    expect(growsMonotonically((n) => glowParams({ size: n }))).toBe(true)
  })

  it('CONTROL: a size counted from the last page of 1,000 rows read is not monotonic', () => {
    expect(growsMonotonically((n) => glowParams({ size: n % 1000 }))).toBe(false)
  })

  const paintsNothing = (params) => {
    const { el, log } = fakeCanvas()
    mountGlow(el).update(params, VP)
    return params.intensity === 0 && params.radiusFrac === 0 && calls(log, 'clearRect').length === 1 &&
      calls(log, 'fillRect').length === 0 && el.animate.mock.calls.length === 0 && shadowAlpha(640, 400, params, VP) === 0
  }

  it('size 0 (or junk) is no light: nothing painted, nothing animated, no shadow', () => {
    for (const size of [0, -3, NaN, undefined, 'lots']) expect(paintsNothing(glowParams({ size }))).toBe(true)
  })

  it('CONTROL: one thing is some light, so the same check fails', () => {
    expect(paintsNothing(glowParams({ size: 1 }))).toBe(false)
  })

  const isFaintFlicker = (g) => g.intensity > 0 && g.intensity < 0.25 && g.coreFrac === 0 && g.flicker.playing &&
    g.flicker.low < 1 && g.stops[0].color !== 'rgba(255,255,255,1)'
  const isSun = (g) => g.intensity === 1 && g.coreFrac > 0 && g.stops[0].color === 'rgba(255,255,255,1)' && !g.flicker.playing && g.drift.playing

  it('one or two things are a faint flicker; 5,000 and more are a sun', () => {
    const one = generateCatalogue({ projects: 1, foldersPerProject: 0, filesPerProject: 0 })
    const two = generateCatalogue({ projects: 1, foldersPerProject: 0, filesPerProject: 1 })
    expect([catalogueSize(one), catalogueSize(two)]).toEqual([1, 2])
    for (const c of [one, two]) expect(isFaintFlicker(glowParams({ size: catalogueSize(c) }))).toBe(true)
    for (const size of [catalogueSize(BIG), 5000, 50000]) expect(isSun(glowParams({ size }))).toBe(true)
    expect(isSun(glowParams({ size: 50 })) || isFaintFlicker(glowParams({ size: 50 }))).toBe(false)
  })

  it('CONTROL: the sun sized from its closed view is no sun, and neither check passes the other end', () => {
    expect(isSun(glowParams({ size: inView(BIG, {}) }))).toBe(false)
    expect(isSun(glowParams({ size: 2 }))).toBe(false)
    expect(isFaintFlicker(glowParams({ size: 5000 }))).toBe(false)
  })

  const carries = (g, hex) => rgbaOf(g.stops[g.stops.length - 1].color).rgb.join(',') === hexRgb(hex).join(',')

  it('the colour is a parameter: the stops carry it; a bad colour falls back to the default', () => {
    expect(DEFAULT_GLOW_COLOR).toBe('#ffb347')
    expect(carries(glowParams({ size: 117 }), DEFAULT_GLOW_COLOR)).toBe(true)
    for (const [color, hex] of [['#33aaff', '#33aaff'], ['#3af', '#33aaff'], [' #7CFF9E ', '#7cff9e']]) {
      const g = glowParams({ size: 117, color })
      const base = glowParams({ size: 117 })
      expect(carries(g, hex)).toBe(true)
      expect([g.intensity, g.radiusFrac, g.drift, g.flicker]).toEqual([base.intensity, base.radiusFrac, base.drift, base.flicker])
    }
    for (const bad of ['', 'red', 'rgb(1,2,3)', '#12345', '#ggg', null, 42]) {
      expect(glowParams({ size: 117, color: bad }).stops).toEqual(glowParams({ size: 117 }).stops)
    }
  })

  it('CONTROL: a glow that ignores its colour fails the same check', () => {
    expect(carries(glowParams({ size: 117 /* color dropped */ }), '#33aaff')).toBe(false)
  })
})

describe('calm and light modes', () => {
  const isStill = (g) => !g.drift.playing && g.drift.degrees === 0 && !g.flicker.playing
  const SIZES = [1, 2, 50, 500, 5000, 100000]

  it('calm (reduced motion) stills the drift and the flicker, and leaves the light itself alone', () => {
    for (const size of SIZES) {
      const calm = glowParams({ size, reducedMotion: true })
      const moving = glowParams({ size })
      expect(isStill(calm)).toBe(true)
      expect([calm.stops, calm.intensity, calm.radiusFrac]).toEqual([moving.stops, moving.intensity, moving.radiusFrac])
    }
  })

  it('CONTROL: the same project without calm mode is not still', () => {
    for (const size of [1, 2, 5000]) expect(isStill(glowParams({ size }))).toBe(false)
  })

  const readable = (g) => g.stops.length === 2 && isStill(g) && rgbaOf(g.stops[0].color).a <= 0.45 &&
    Math.min(...g.stops.map(whiteOver)) >= 4.5

  it('light mode: two stops, no motion, a core not lifted to white; white text over it is >= 4.5:1', () => {
    for (const color of [DEFAULT_GLOW_COLOR, '#4fc3f7', '#b388ff', '#7cff9e', '#ff5252', '#ffff00']) {
      for (const size of SIZES) expect(readable(glowParams({ size, color, light: true }))).toBe(true)
    }
  })

  it('CONTROL: the full sun fails it, and so does a light-shaped glow with a white core transplanted in', () => {
    const full = glowParams({ size: 5000 })
    const light = glowParams({ size: 5000, light: true })
    expect(readable(full)).toBe(false)
    expect(whiteOver(full.stops[0])).toBeLessThan(1.01) // white on white
    expect(readable({ ...light, stops: [full.stops[0], light.stops[1]] })).toBe(false)
  })
})

describe('shadowAlpha', () => {
  /** The largest change between horizontally or vertically adjacent pixels. */
  function maxStep(alpha, g, vp = VP) {
    let max = 0
    const above = new Float64Array(vp.width)
    for (let y = 0; y < vp.height; y++) {
      let left = 0
      for (let x = 0; x < vp.width; x++) {
        const a = alpha(x + 0.5, y + 0.5, g, vp)
        if (x > 0) max = Math.max(max, Math.abs(a - left))
        if (y > 0) max = Math.max(max, Math.abs(a - above[x]))
        above[x] = a
        left = a
      }
    }
    return max
  }
  const snapping = (sx, sy, g, vp) => (shadowAlpha(sx, sy, g, vp) > 0.05 ? 0.55 : 0)

  it('is continuous: adjacent pixels across a 1280x800 viewport differ by a hair', () => {
    for (const size of [50, 5000]) expect(maxStep(shadowAlpha, glowParams({ size }))).toBeLessThan(0.01)
  })

  it('CONTROL: a shadow that snaps on fails the same check', () => {
    expect(maxStep(snapping, glowParams({ size: 5000 }))).toBeGreaterThan(0.01)
  })

  const zeroAt = (alpha, g, pts) => pts.every(([x, y]) => alpha(x, y, g, VP) === 0)
  const sun = glowParams({ size: 5000 })
  const R = sun.radiusFrac * 800
  const FAR = [[0, 0], [1279, 0], [0, 799], [1279, 799], [640 + 0.86 * R, 400], [640, 400 - 0.86 * R], [640 - 0.7 * R, 400 + 0.7 * R]]
  const GRID = [...Array(9)].flatMap((_, i) => [...Array(9)].map((__, j) => [i * 160, j * 100]))
  const unfading = (sx, sy, g, vp) => shadowAlpha(vp.width / 2, vp.height / 2, g, vp)

  it('is 0 far from the core, and 0 everywhere when the glow is faint or absent', () => {
    expect(shadowAlpha(640, 400, sun, VP)).toBeCloseTo(0.55)
    expect(zeroAt(shadowAlpha, sun, FAR)).toBe(true)
    for (const g of [glowParams({ size: 1 }), glowParams({ size: 0 }), null]) expect(zeroAt(shadowAlpha, g, GRID)).toBe(true)
  })

  it('CONTROL: a shadow with no fall-off is not 0 far away; the sun is not 0 at its core', () => {
    expect(zeroAt(unfading, sun, FAR)).toBe(false)
    expect(zeroAt(shadowAlpha, sun, GRID)).toBe(false)
  })
})

describe('mountGlow', () => {
  afterEach(() => { delete globalThis.requestAnimationFrame })

  const repaintsOnlyOnChange = (mount) => {
    const { el, log } = fakeCanvas()
    const glow = mount(el)
    for (let i = 0; i < 6; i++) glow.update(glowParams({ size: 117 }), { ...VP }, 2) // fresh but equal inputs
    return glow.paints() === 1 && calls(log, 'fillRect').length === 1
  }
  const naiveMount = (el) => {
    const ctx = el.getContext('2d')
    let n = 0
    return { update(g, vp, dpr = 1) { ctx.clearRect(0, 0, vp.width * dpr, vp.height * dpr); ctx.fillRect(0, 0, vp.width * dpr, vp.height * dpr); n++; return true }, paints: () => n }
  }

  it('paints once per change of inputs (params, viewport, dpr), with the stops it was given', () => {
    expect(repaintsOnlyOnChange(mountGlow)).toBe(true)
    const { el, log } = fakeCanvas()
    const glow = mountGlow(el)
    const g = glowParams({ size: 117 })
    expect(glow.update(g, VP, 2)).toBe(true)
    expect([el.width, el.height]).toEqual([2560, 1600])
    const grad = calls(log, 'gradient')[0][1]
    expect(grad.stops).toEqual(g.stops)
    expect(calls(log, 'fillRect')[0]).toEqual(['fillRect', grad, 0, 0, 2560, 1600])
    expect(glow.update(glowParams({ size: 117 }), VP, 2)).toBe(false)
    expect(glow.update(g, { width: 1000, height: 700 }, 2)).toBe(true)
    expect(glow.update(g, { width: 1000, height: 700 }, 1)).toBe(true)
    expect(glow.update(glowParams({ size: 5000 }), { width: 1000, height: 700 }, 1)).toBe(true)
    expect(glow.update(glowParams({ size: 5000, color: '#3af' }), { width: 1000, height: 700 }, 1)).toBe(true)
    expect([glow.paints(), calls(log, 'fillRect').length]).toEqual([5, 5])
  })

  it('CONTROL: a mount that repaints on every update fails the same check', () => {
    expect(repaintsOnlyOnChange(naiveMount)).toBe(false)
  })

  it('runs drift and flicker through element.animate, never a script frame', () => {
    globalThis.requestAnimationFrame = vi.fn()
    const { el, anims } = fakeCanvas()
    const glow = mountGlow(el)
    const g = glowParams({ size: 1 })
    for (let i = 0; i < 10; i++) glow.update(g, VP)
    expect(el.animate).toHaveBeenCalledTimes(2)
    expect(driftOf(anims).keyframes).toEqual([{ filter: 'hue-rotate(0deg)' }, { filter: `hue-rotate(${g.drift.degrees}deg)` }])
    expect(driftOf(anims).options).toMatchObject({ duration: g.drift.periodMs, iterations: Infinity })
    expect(flickerOf(anims).keyframes).toEqual([{ opacity: 1 }, { opacity: g.flicker.low }])
    expect(flickerOf(anims).options).toMatchObject({ duration: g.flicker.periodMs, iterations: Infinity })
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled()
  })

  /** Grow from one thing to three (the drift's degrees change): adjusted in place, or restarted? */
  function growOnce(fake) {
    const glow = mountGlow(fake.el)
    glow.update(glowParams({ size: 1 }), VP)
    const next = glowParams({ size: 3 })
    glow.update(next, VP)
    const cancelled = fake.anims.filter((a) => a.cancel.mock.calls.length > 0).length
    const inPlace = fake.el.animate.mock.calls.length === 2 && cancelled === 0 &&
      driftOf(fake.anims).keyframes[1].filter === `hue-rotate(${next.drift.degrees}deg)` &&
      driftOf(fake.anims).effect.updateTiming.mock.calls.at(-1)[0].duration === next.drift.periodMs
    return { glow, inPlace }
  }

  it('a change of degrees adjusts the running animation in place (setKeyframes/updateTiming), not a new animate()', () => {
    const fake = fakeCanvas()
    const { glow, inPlace } = growOnce(fake)
    expect(glowParams({ size: 3 }).drift.degrees).not.toBe(glowParams({ size: 1 }).drift.degrees)
    expect(inPlace).toBe(true)
    glow.update(glowParams({ size: 5000 }), VP) // past a dozen: the flicker goes, the drift stays
    expect(fake.el.animate).toHaveBeenCalledTimes(2)
    expect(flickerOf(fake.anims)).toBeUndefined()
    expect(driftOf(fake.anims).keyframes[1].filter).toBe('hue-rotate(40deg)')
  })

  it('CONTROL: animations that cannot be adjusted are restarted, and the same check catches it', () => {
    expect(growOnce(fakeCanvas({ withEffect: false })).inPlace).toBe(false)
  })

  const stilled = (anims) => anims.length === 2 && anims.every((a) => a.cancel.mock.calls.length === 1) && live(anims).length === 0
  function settle(mode) {
    const fake = fakeCanvas()
    const glow = mountGlow(fake.el)
    glow.update(glowParams({ size: 1 }), VP)
    glow.update(glowParams({ size: 1, ...mode }), VP)
    glow.update(glowParams({ size: 1, ...mode }), VP)
    return { fake, glow }
  }

  it('calm and light modes cancel the running motion; leaving them starts it again', () => {
    for (const mode of [{ reducedMotion: true }, { light: true }]) {
      const { fake, glow } = settle(mode)
      expect(stilled(fake.anims)).toBe(true)
      glow.update(glowParams({ size: 1 }), VP)
      expect(live(fake.anims).length).toBe(2)
    }
  })

  it('CONTROL: forgetting the mode leaves the motion running, and the same check fails', () => {
    expect(stilled(settle({}).fake.anims)).toBe(false)
  })

  const allPaused = (anims) => anims.length > 0 && anims.every((a) => a.state === 'paused')

  it('setActive(false) pauses (even motion started while hidden); setActive(true) plays', () => {
    const a = fakeCanvas()
    const ga = mountGlow(a.el)
    ga.update(glowParams({ size: 1 }), VP)
    ga.setActive(false)
    expect(allPaused(a.anims)).toBe(true)
    ga.setActive(true)
    expect(a.anims.every((x) => x.play.mock.calls.length === 1 && x.state === 'running')).toBe(true)
    const b = fakeCanvas()
    const gb = mountGlow(b.el)
    gb.setActive(false)
    gb.update(glowParams({ size: 1 }), VP)
    expect(allPaused(b.anims)).toBe(true)
  })

  it('CONTROL: a visible glow is not paused', () => {
    const { el, anims } = fakeCanvas()
    mountGlow(el).update(glowParams({ size: 1 }), VP)
    expect(allPaused(anims)).toBe(false)
  })

  it('destroy cancels every animation; a later update paints afresh', () => {
    const fake = fakeCanvas()
    const glow = mountGlow(fake.el)
    glow.update(glowParams({ size: 1 }), VP)
    glow.destroy()
    expect(stilled(fake.anims)).toBe(true)
    expect(glow.update(glowParams({ size: 1 }), VP)).toBe(true)
    expect(glow.paints()).toBe(2)
  })

  it('CONTROL: without destroy the motion keeps running', () => {
    const { el, anims } = fakeCanvas()
    mountGlow(el).update(glowParams({ size: 1 }), VP)
    expect(stilled(anims)).toBe(false)
  })
})
