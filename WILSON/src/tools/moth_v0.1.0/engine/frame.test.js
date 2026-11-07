// =============================================================================
// frame.test.js — what one frame draws (MO2a, the brief's item 3; frame.js).
// Pins, on hand-built scenes and on fixture graphs (fixtureForTarget ->
// buildGraph, placed on a grid): culling of dots and lines on both axes; the
// level of detail by zoom; clustering by zoom AND by budget (1,000 dots / 2,000
// lines, 300 / 600 in light mode), counting only what is in view and drawing
// no more than the budget, whichever budget grew the cell; clusters built
// from whole world cells, so a 1 px pan never reshuffles one; a line to an
// off-screen dot kept as a cluster edge; mist on clusters and cluster edges;
// labels by level (MID: containers and the selection, NEAR: all, light MID:
// none), de-clutter by priority that never drops the selection, the label of
// a dot just off the left edge, and the label cap. Each rule has a sibling
// CONTROL running the same check on a planted fault, which must fail.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { computeFrame, LOD, FRAME_DEFAULTS } from './frame.js'
import { camera, panBy, screenToWorld, worldToScreen, visibleWorldRect } from './camera.js'
import { buildGraph, defaultRadius, EDGE_CODE } from './model.js'
import { fixtureForTarget, seededRandom } from './fixtures.js'

const VP = { width: 800, height: 600 }
const MID_CAM = camera(0, 0, 0.5)
const NEAR_CAM = camera(0, 0, 1)
const K = 0.2 // FAR by zoom
const FAR_CAM = camera(0, 0, K)
const CELL = FRAME_DEFAULTS.cellPx / 2 ** Math.floor(Math.log2(K)) // the engine's world cell at K: 384
const near = (a, b) => Math.abs(a - b) < 1e-6
const sum = (a) => a.reduce((s, v) => s + v, 0)
const onScreen = (x, y, vp = VP) => x >= 0 && x <= vp.width && y >= 0 && y <= vp.height

/** A scene by hand: dots [{ x, y, r, container, collapsed, dim, label, count, priority }], lines [[a, b, kind]]. */
function makeScene(dots, lines = []) {
  const n = dots.length
  const m = lines.length
  const s = {
    n, xy: new Float32Array(2 * n), r: new Float32Array(n), container: new Uint8Array(n), collapsed: new Uint8Array(n),
    dim: new Uint8Array(n), label: new Array(n), count: new Uint32Array(n), priority: new Float32Array(n),
    m, ends: new Uint32Array(2 * m), kind: new Uint8Array(m),
  }
  dots.forEach((d, i) => {
    s.xy[2 * i] = d.x; s.xy[2 * i + 1] = d.y; s.r[i] = d.r ?? 2
    s.container[i] = d.container ? 1 : 0; s.collapsed[i] = d.collapsed ? 1 : 0; s.dim[i] = d.dim ? 1 : 0
    s.label[i] = d.label ?? ''; s.count[i] = d.count ?? 0; s.priority[i] = d.priority ?? 0
  })
  lines.forEach(([a, b, kind = 0], e) => { s.ends[2 * e] = a; s.ends[2 * e + 1] = b; s.kind[e] = kind })
  return s
}

/** n points on a square grid `step` apart, centred on the origin. */
function grid(n, step) {
  const cols = Math.ceil(Math.sqrt(n))
  const off = ((cols - 1) * step) / 2
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) * step - off, y: Math.floor(i / cols) * step - off }))
}
/** L lines over n dots, no line a loop. */
const ring = (n, L) => Array.from({ length: L }, (_, e) => [e % n, ((e % n) + 1 + Math.floor(e / n)) % n])

/** A fixture graph as the renderer builds its scene (renderer.js buildScene), on a 30-unit grid. */
const memo = new Map()
function fixtureScene(nodes, edges) {
  const key = `${nodes}/${edges}`
  if (memo.has(key)) return memo.get(key)
  const { catalogue, view } = fixtureForTarget({ nodes, edges })
  const g = buildGraph(catalogue, view)
  const at = new Map(g.nodes.map((nd, i) => [nd.id, i]))
  const pos = grid(g.nodes.length, 30)
  const s = makeScene(
    g.nodes.map((nd, i) => {
      const container = nd.kind === 'project' || nd.kind === 'folder'
      return { ...pos[i], r: defaultRadius(nd), container, collapsed: nd.collapsed, dim: nd.dim, label: nd.label, count: nd.count,
        priority: (container ? 1000 : 0) + nd.count - nd.depth }
    }),
    g.edges.map((e) => [at.get(e.source), at.get(e.target), EDGE_CODE[e.kind]]),
  )
  memo.set(key, { g, s })
  return memo.get(key)
}

const labelled = (out) => out.labels.map((l) => l.index).sort((a, b) => a - b).join(',')

// ── Culling ──────────────────────────────────────────────────────────────────
// k 1 at the origin: the drawn world is x in [-424, 424], y in [-324, 324] (24 px margin).
const CULL = makeScene(
  [{ x: 0, y: 0 }, { x: -600, y: 0 }, { x: -432, y: 0, r: 10 }, // on, off, centre off but 10 px radius reaching in
    { x: 2000, y: 2000 }, { x: 2100, y: 2000 }, { x: -1000, y: 100 }, { x: 1000, y: 100 }],
  [[3, 4], [5, 6]], // wholly off screen; both ends off but crossing the view
)
const cullingHolds = (out) => {
  const drawn = new Set(out.dots.index)
  return drawn.has(0) && drawn.has(2) && !drawn.has(1) && out.edges.count === 1 && out.edges.x1[0] === -600 && out.edges.x2[0] === 1400
}
/** Planted fault: a dot drawn only when its centre is on the bare screen, a line only when both ends are. */
function naiveCull(scene, cam, vp) {
  const on = (i) => { const p = worldToScreen(cam, vp, scene.xy[2 * i], scene.xy[2 * i + 1]); return onScreen(p.x, p.y, vp) }
  const out = { dots: { index: [] }, edges: { count: 0, x1: [], x2: [] } }
  for (let i = 0; i < scene.n; i++) if (on(i)) out.dots.index.push(i)
  for (let e = 0; e < scene.m; e++) {
    const [a, b] = [scene.ends[2 * e], scene.ends[2 * e + 1]]
    if (!on(a) || !on(b)) continue
    out.edges.count++
    out.edges.x1.push(worldToScreen(cam, vp, scene.xy[2 * a], 0).x); out.edges.x2.push(worldToScreen(cam, vp, scene.xy[2 * b], 0).x)
  }
  return out
}

describe('culling and level of detail', () => {
  it('a dot beyond viewport+margin is not drawn, one partly inside is; a line is drawn only when its box meets the view', () => {
    const out = computeFrame(CULL, NEAR_CAM, VP, { selected: -1 })
    expect(cullingHolds(out)).toBe(true)
    expect(out.culled).toBe(5)
  })

  it('CONTROL: a centre-only culler that wants both ends of a line on screen fails the same check', () => {
    expect(cullingHolds(naiveCull(CULL, NEAR_CAM, VP))).toBe(false)
  })

  // Off screen only above or below the view: the left and right tests cannot see these.
  const CULL_Y = makeScene(
    [{ x: 0, y: 0 }, { x: 0, y: 2000 }, { x: -100, y: 2000 }, { x: 100, y: -2000 }, { x: 0, y: -1000 }, { x: 0, y: 1000 }],
    [[1, 2], [4, 5]], // wholly below the view; both ends off but crossing it
  )
  const cullingHoldsAboveBelow = (out) => out.dots.index.join() === '0' && out.edges.count === 1 && out.edges.y1[0] === -700 && out.edges.y2[0] === 1300
  /** Planted fault: culling left and right only, so everything above and below the screen is drawn. */
  function xOnlyCull(scene, cam, vp) {
    const rect = visibleWorldRect(cam, vp, FRAME_DEFAULTS.marginPx)
    const out = { dots: { index: [] }, edges: { count: 0, y1: [], y2: [] } }
    for (let i = 0; i < scene.n; i++) if (scene.xy[2 * i] >= rect.minX && scene.xy[2 * i] <= rect.maxX) out.dots.index.push(i)
    for (let e = 0; e < scene.m; e++) {
      const [a, b] = [scene.ends[2 * e], scene.ends[2 * e + 1]]
      if (Math.max(scene.xy[2 * a], scene.xy[2 * b]) < rect.minX || Math.min(scene.xy[2 * a], scene.xy[2 * b]) > rect.maxX) continue
      out.edges.count++
      out.edges.y1.push(worldToScreen(cam, vp, 0, scene.xy[2 * a + 1]).y); out.edges.y2.push(worldToScreen(cam, vp, 0, scene.xy[2 * b + 1]).y)
    }
    return out
  }

  it('a dot or line off screen only above or below is not drawn; a line crossing the view top to bottom is', () => {
    const out = computeFrame(CULL_Y, NEAR_CAM, VP, { selected: -1 })
    expect(cullingHoldsAboveBelow(out)).toBe(true)
    expect(out.culled).toBe(5)
  })

  it('CONTROL: a culler that tests only left and right fails the same check', () => {
    expect(cullingHoldsAboveBelow(xOnlyCull(CULL_Y, NEAR_CAM, VP))).toBe(false)
  })

  const LOD_TABLE = [[0.2, LOD.FAR], [0.3499, LOD.FAR], [0.35, LOD.MID], [0.6, LOD.MID], [0.9999, LOD.MID], [1, LOD.NEAR], [4, LOD.NEAR]]
  const lodHolds = (lodOf) => LOD_TABLE.every(([k, want]) => lodOf(k) === want)

  it('lod by zoom: FAR below clusterBelowK (clustered "zoom"), NEAR from labelAllAboveK, MID between', () => {
    expect(lodHolds((k) => computeFrame(CULL, camera(0, 0, k), VP).lod)).toBe(true)
    expect(computeFrame(CULL, FAR_CAM, VP).clustered).toBe('zoom')
  })

  it('CONTROL: thresholds off at the boundary (<= and >) fail the same table', () => {
    expect(lodHolds((k) => (k <= 0.35 ? LOD.FAR : k > 1 ? LOD.NEAR : LOD.MID))).toBe(false)
  })
})

// ── Clustering by budget ─────────────────────────────────────────────────────
const withinBudget = (out, budget, n) => out.lod === LOD.FAR && out.clustered === 'budget' &&
  out.dots.count + out.clusters.count <= budget && out.dots.count + sum(out.clusters.size) === n
const OVER = () => [
  [fixtureScene(1001, 2002).s, false, 1000], [makeScene(grid(1001, 30)), false, 1000], [makeScene(grid(400, 30), ring(400, 2001)), false, 1000],
  [fixtureScene(301, 602).s, true, 300], [makeScene(grid(301, 30)), true, 300], [makeScene(grid(200, 30), ring(200, 601)), true, 300],
]
const NO_BUDGET = { maxDots: Infinity, maxLines: Infinity, lightMaxDots: Infinity, lightMaxLines: Infinity }

describe('clustering by budget', () => {
  it('exactly on the budget at MID zoom stays MID and draws every dot and line (full and light)', () => {
    for (const [n, m] of [[1000, 2000], [1001, 2002], [300, 600], [301, 602]]) { // the fixtures are exact
      const { g, s } = fixtureScene(n, m)
      expect([g.nodes.length, g.edges.length, s.n, s.m]).toEqual([n, m, n, m])
    }
    for (const [s, light] of [[fixtureScene(1000, 2000).s, false], [fixtureScene(300, 600).s, true], [makeScene(grid(200, 30), ring(200, 600)), true]]) {
      const out = computeFrame(s, MID_CAM, VP, { light, selected: -1 })
      expect([out.lod, out.clustered, out.dots.count, out.edges.count]).toEqual([LOD.MID, null, s.n, s.m])
    }
  })

  it('over the budget (dots or lines) at MID zoom: FAR, clustered "budget", dots + clusters within it, no dot lost', () => {
    for (const [s, light, budget] of OVER()) expect(withinBudget(computeFrame(s, MID_CAM, VP, { light }), budget, s.n)).toBe(true)
  })

  it('CONTROL: an engine that clusters by zoom only (no budget) fails the same check on every case', () => {
    for (const [s, light, budget] of OVER()) expect(withinBudget(computeFrame(s, MID_CAM, VP, { light, ...NO_BUDGET }), budget, s.n)).toBe(false)
  })

  it('CONTROL: without light mode the 300/600 cases do not cluster, so the light check fails', () => {
    for (const [s, , budget] of OVER().filter((c) => c[1])) expect(withinBudget(computeFrame(s, MID_CAM, VP, {}), budget, s.n)).toBe(false)
  })

  // The budget counts what is in view: dots and lines off screen do not hold a person out of the clusters.
  const FAR_OFF = 20000
  const offScreen = (p) => ({ x: p.x + FAR_OFF, y: p.y })
  const inViewScenes = () => [
    makeScene([...grid(10, 30), ...grid(5000, 3).map(offScreen)]), // 5,010 dots, 10 in view
    makeScene([...grid(10, 30), ...grid(900, 30).map(offScreen)], ring(900, 2500).map(([a, b]) => [a + 10, b + 10])), // 2,500 lines, none in view
  ]
  const opensInView = (frameOf) => inViewScenes().every((s) => {
    const out = frameOf(s)
    return out.clustered === null && out.lod === LOD.NEAR && out.dots.count === 10
  })

  it('a project over the budget opens when zoomed in: only the dots and lines in view count', () => {
    expect(opensInView((s) => computeFrame(s, NEAR_CAM, VP))).toBe(true)
  })

  it('CONTROL: a budget that counts the whole project stays clustered at every zoom and fails the same check', () => {
    const wholeProject = (s) => computeFrame(s, NEAR_CAM, VP, s.n > FRAME_DEFAULTS.maxDots || s.m > FRAME_DEFAULTS.maxLines ? { maxDots: -1 } : {})
    expect(opensInView(wholeProject)).toBe(false)
  })

  // Dots every 11 px over a 1280 x 800 view: 504 cells at the base cell, so only the 300 budget has to grow the
  // cell (the 301-dot cases above fit in far fewer cells, whichever number the growth compares with).
  const WIDE = { width: 1280, height: 800 }
  const denseScene = () => {
    const dots = []
    for (let x = -634.5; x <= 640; x += 11) for (let y = -394.5; y <= 400; y += 11) dots.push({ x, y })
    return makeScene(dots)
  }

  it('in light mode the cell grows until dots + clusters are within 300, not 1,000', () => {
    const s = denseScene()
    expect(withinBudget(computeFrame(s, NEAR_CAM, WIDE, { light: true }), 300, s.n)).toBe(true)
  })

  it('CONTROL: a growth rule holding the full budget stops at the base cell, draws over 300 and fails the same check', () => {
    const s = denseScene()
    const out = computeFrame(s, NEAR_CAM, WIDE, { light: true, lightMaxDots: FRAME_DEFAULTS.maxDots })
    expect(out.dots.count + out.clusters.count).toBeGreaterThan(300)
    expect(withinBudget(out, 300, s.n)).toBe(false)
  })

  // A large viewport (2560 x 1440 CSS px) at MID: 1,000 interior cells hold two visible dots each, and every
  // border cell (its square meets the view+margin) holds one dot that is itself off screen. The cells holding
  // a visible dot fit the budget exactly, but the border cells are drawn too (whole cells, for pan stability),
  // so the cell must grow until the cells that will be DRAWN fit (the frame test-writer's finding, fixed).
  const BIG = { width: 2560, height: 1440 }
  const BASE_CELL = FRAME_DEFAULTS.cellPx / 2 ** Math.floor(Math.log2(MID_CAM.k))
  const borderScene = () => {
    const cell = BASE_CELL
    const rect = visibleWorldRect(MID_CAM, BIG, FRAME_DEFAULTS.marginPx)
    const dots = []
    let filled = 0
    for (let gy = Math.floor(rect.minY / cell); gy <= Math.floor(rect.maxY / cell); gy++) {
      for (let gx = Math.floor(rect.minX / cell); gx <= Math.floor(rect.maxX / cell); gx++) {
        const [x0, y0] = [gx * cell, gy * cell]
        if (x0 >= rect.minX && x0 + cell <= rect.maxX && y0 >= rect.minY && y0 + cell <= rect.maxY) {
          if (filled++ < 1000) dots.push({ x: x0 + 30, y: y0 + 48 }, { x: x0 + 66, y: y0 + 48 })
        } else {
          dots.push({ x: x0 < rect.minX ? x0 + 2 : x0 + cell > rect.maxX ? x0 + cell - 2 : x0 + 48,
            y: y0 < rect.minY ? y0 + 2 : y0 + cell > rect.maxY ? y0 + cell - 2 : y0 + 48 })
        }
      }
    }
    return makeScene(dots)
  }
  /** At the base cell: cells holding a visible dot, and cells whose square meets the view (what is drawn). */
  const cellCounts = (s) => {
    const rect = visibleWorldRect(MID_CAM, BIG, FRAME_DEFAULTS.marginPx)
    const vis = new Set()
    const drawn = new Set()
    for (let i = 0; i < s.n; i++) {
      const [x, y] = [s.xy[2 * i], s.xy[2 * i + 1]]
      const [cx, cy] = [Math.floor(x / BASE_CELL), Math.floor(y / BASE_CELL)]
      const key = `${cx},${cy}`
      if (x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY) vis.add(key)
      const [x0, y0] = [cx * BASE_CELL, cy * BASE_CELL]
      if (!(x0 + BASE_CELL < rect.minX || x0 > rect.maxX || y0 + BASE_CELL < rect.minY || y0 > rect.maxY)) drawn.add(key)
    }
    return { visible: vis.size, drawn: drawn.size }
  }

  it('the border-cell scene is over budget at MID and clusters by budget', () => {
    const out = computeFrame(borderScene(), MID_CAM, BIG)
    expect([out.lod, out.clustered]).toEqual([LOD.FAR, 'budget'])
  })

  it('dots + clusters stay within the budget on a large viewport with off-screen dots in border cells', () => {
    const s = borderScene()
    expect(withinBudget(computeFrame(s, MID_CAM, BIG), 1000, s.n)).toBe(true)
  })

  it('CONTROL: a growth rule that counts only cells holding a visible dot stops at the base cell and draws over budget', () => {
    const { visible, drawn } = cellCounts(borderScene())
    expect(visible).toBeLessThanOrEqual(1000) // that rule would not grow the cell…
    expect(drawn).toBeGreaterThan(1000) // …and the whole cells it then draws exceed the budget
  })
})

// ── Clusters: whole world cells, edges, mist ─────────────────────────────────
const SPREAD = (() => {
  const rnd = seededRandom(11)
  return makeScene(Array.from({ length: 1500 }, () => ({ x: (rnd() - 0.5) * 8000, y: (rnd() - 0.5) * 6000 })))
})()
/** 120 frames, panning 1 px at a time: 80 to the side, then 40 down. */
function panFrames(frameFn) {
  const frames = []
  let cam = FAR_CAM
  for (let s = 0; s < 120; s++) {
    frames.push({ cam, out: frameFn(SPREAD, cam, VP) })
    cam = s < 80 ? panBy(cam, -1, 0) : panBy(cam, 0, -1)
  }
  return frames
}
const worldClusters = ({ cam, out }) => out.clusters.x.map((x, c) => ({ ...screenToWorld(cam, VP, x, out.clusters.y[c]), size: out.clusters.size[c] }))
/** Every cluster whose cell still meets the next frame's view is there again: same size, same world centre. */
function panStable(frames) {
  for (let f = 1; f < frames.length; f++) {
    const rect = visibleWorldRect(frames[f].cam, VP, FRAME_DEFAULTS.marginPx)
    const after = worldClusters(frames[f])
    for (const a of worldClusters(frames[f - 1])) {
      const [x0, y0] = [Math.floor(a.x / CELL) * CELL, Math.floor(a.y / CELL) * CELL]
      if (x0 + CELL < rect.minX || x0 > rect.maxX || y0 + CELL < rect.minY || y0 > rect.maxY) continue // its cell left the view
      if (!after.some((b) => b.size === a.size && near(b.x, a.x) && near(b.y, a.y))) return false
    }
  }
  return true
}
/** Planted fault: the obvious clusterer, a grid anchored to the SCREEN over the dots on screen only. */
function screenGrid(scene, cam, vp) {
  const cells = new Map()
  for (let i = 0; i < scene.n; i++) {
    const p = worldToScreen(cam, vp, scene.xy[2 * i], scene.xy[2 * i + 1])
    if (!onScreen(p.x, p.y, vp)) continue
    const key = `${Math.floor(p.x / (CELL * K))},${Math.floor(p.y / (CELL * K))}`
    if (!cells.has(key)) cells.set(key, { x: 0, y: 0, size: 0 })
    const c = cells.get(key)
    c.x += p.x; c.y += p.y; c.size++
  }
  const clusters = { x: [], y: [], size: [] }
  for (const c of cells.values()) if (c.size > 1) { clusters.x.push(c.x / c.size); clusters.y.push(c.y / c.size); clusters.size.push(c.size) }
  return { clusters }
}

// A group of three near the origin with two lines to one dot 20,000 units off to the right.
const OFF = makeScene([{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 20000, y: 10 }], [[0, 3], [1, 3], [0, 1]])
const offEdgeKept = (out) => out.clusterEdges.count === 1 && out.clusterEdges.weight[0] === 2 &&
  [out.clusterEdges.x1[0], out.clusterEdges.x2[0]].filter((x) => x >= 0 && x <= VP.width).length === 1
/** Planted fault: cluster edges kept only when both ends are on screen. */
const bothEndsOnly = (out) => {
  const ce = out.clusterEdges
  const keep = ce.x1.map((x, e) => [x, ce.x2[e]].every((v) => v >= 0 && v <= VP.width))
  const pick = (a) => a.filter((_, e) => keep[e])
  return { ...out, clusterEdges: { count: keep.filter(Boolean).length, x1: pick(ce.x1), x2: pick(ce.x2), weight: pick(ce.weight) } }
}

// Three cells at K: P all mist, Q mixed (unless corrupted), R bright; lines P-R and Q-R.
const MIST = (qAllDim) => makeScene([
  { x: 100, y: 100, dim: 1 }, { x: 110, y: 100, dim: 1 }, { x: 120, y: 100, dim: 1 },
  { x: 900, y: 100, dim: 1 }, { x: 910, y: 100, dim: 1 }, { x: 920, y: 100, dim: qAllDim },
  { x: 100, y: 900 }, { x: 110, y: 900 }, { x: 120, y: 900 },
], [[0, 6], [3, 6]])
function mistHolds(out) {
  const cl = worldClusters({ cam: FAR_CAM, out }).map((c, i) => ({ ...c, dim: out.clusters.dim[i] }))
  const dimAt = (x, y) => cl.find((c) => near(c.x, x) && near(c.y, y))?.dim
  const ce = out.clusterEdges
  const edgeDimAt = (x, y) => {
    for (let e = 0; e < ce.count; e++) {
      const ends = [screenToWorld(FAR_CAM, VP, ce.x1[e], ce.y1[e]), screenToWorld(FAR_CAM, VP, ce.x2[e], ce.y2[e])]
      if (ends.some((p) => near(p.x, x) && near(p.y, y))) return ce.dim[e]
    }
  }
  return dimAt(110, 100) === 1 && dimAt(910, 100) === 0 && dimAt(110, 900) === 0 && edgeDimAt(110, 100) === 1 && edgeDimAt(910, 100) === 0
}

describe('clusters', () => {
  it('are whole world cells: 120 one-pixel pans never change a cell\'s size or world centre', () => {
    const frames = panFrames(computeFrame)
    expect(frames.every((f) => f.out.lod === LOD.FAR && f.out.clusters.count > 20)).toBe(true)
    expect(panStable(frames)).toBe(true)
    const first = worldClusters(frames[0])
    expect(worldClusters(frames.at(-1)).some((b) => !first.some((a) => near(a.x, b.x) && near(a.y, b.y)))).toBe(true) // cells entered
  })

  it('CONTROL: a screen-anchored grid over the dots on screen fails the same pan check', () => {
    const frames = panFrames(screenGrid)
    expect(panStable([frames[0], frames[0]])).toBe(true) // still when nothing moves: the failure is the pan's
    expect(panStable(frames)).toBe(false)
  })

  it('a line from an on-screen dot to an off-screen dot survives at FAR as one summed cluster edge', () => {
    const out = computeFrame(OFF, FAR_CAM, VP)
    expect(offEdgeKept(out)).toBe(true)
    expect(out.clusters.count + out.dots.count).toBe(1) // the far dot's cell itself is culled
  })

  it('CONTROL: keeping only cluster edges with both ends on screen fails the same check', () => {
    expect(offEdgeKept(bothEndsOnly(computeFrame(OFF, FAR_CAM, VP)))).toBe(false)
  })

  it('a cluster is mist only when all its dots are; a cluster edge is mist when either end is', () => {
    expect(mistHolds(computeFrame(MIST(0), FAR_CAM, VP))).toBe(true)
  })

  it('CONTROL: the same check fails when the mixed cluster is corrupted to all mist', () => {
    expect(mistHolds(computeFrame(MIST(1), FAR_CAM, VP))).toBe(false)
  })
})

// ── Labels ───────────────────────────────────────────────────────────────────
// Six dots 40 units apart down a column (20 px at MID): no two labels touch. Containers 0 and 2.
const COLUMN = makeScene(Array.from({ length: 6 }, (_, i) => ({ x: 0, y: -100 + 40 * i, label: `dot ${i}`, container: i === 0 || i === 2, priority: i })))
const midLabels = (out) => out.lod === LOD.MID && labelled(out) === '0,2,3'
const noLabelsAtMid = (out) => out.lod === LOD.MID && out.dots.count === 6 && out.labels.length === 0
// Two dots 10 px apart at NEAR: their label boxes overlap.
const CLASH = (pa, pb) => makeScene([{ x: 0, y: 0, label: 'alpha caption', priority: pa }, { x: 10, y: 0, label: 'bravo caption', priority: pb }])
const keeps = (out, kept, dropped) => out.dots.count === 2 && out.labels.some((l) => l.index === kept) && !out.labels.some((l) => l.index === dropped)
// A dot 40 px off the left edge (beyond the margin) whose long label reaches into view.
const EDGE = makeScene([{ x: -440, y: 0, label: 'a fairly long caption here' }, { x: 0, y: 0, label: 'centre' }])
const offLeftLabelled = (out) => !out.dots.index.includes(0) && out.labels.some((l) => l.index === 0)
const onlyDrawn = (out) => ({ ...out, labels: out.labels.filter((l) => out.dots.index.includes(l.index)) })
// Thirty dots 18 px apart, priority = index.
const MANY = makeScene(Array.from({ length: 30 }, (_, i) => ({ x: 0, y: (i - 15) * 18, label: `dot ${i}`, priority: i })))
const cappedToTop = (out, cap) => labelled(out) === Array.from({ length: cap }, (_, j) => 30 - cap + j).join(',')

describe('labels', () => {
  it('MID labels the containers and the selection only; NEAR labels every dot; a fixture at MID labels containers only', () => {
    expect(midLabels(computeFrame(COLUMN, MID_CAM, VP, { selected: 3 }))).toBe(true)
    expect(labelled(computeFrame(COLUMN, camera(0, 0, 1.5), VP, { selected: 3 }))).toBe('0,1,2,3,4,5')
    const { s } = fixtureScene(1000, 2000)
    const out = computeFrame(s, MID_CAM, VP, { selected: -1 })
    expect(out.lod).toBe(LOD.MID)
    expect(out.labels.length).toBeGreaterThan(0)
    expect(out.labels.every((l) => s.container[l.index] === 1)).toBe(true)
  })

  it('CONTROL: a MID that labels like NEAR (labelAllAboveK planted below k) fails the same check', () => {
    expect(midLabels(computeFrame(COLUMN, MID_CAM, VP, { selected: 3, labelAllAboveK: 0.4 }))).toBe(false)
  })

  it('light mode draws no labels at MID (and NEAR still labels everything)', () => {
    expect(noLabelsAtMid(computeFrame(COLUMN, MID_CAM, VP, { light: true, selected: 3 }))).toBe(true)
    expect(computeFrame(COLUMN, camera(0, 0, 1.5), VP, { light: true, selected: 3 }).labels.length).toBe(6)
  })

  it('CONTROL: the same scene in full mode fails the no-labels check', () => {
    expect(noLabelsAtMid(computeFrame(COLUMN, MID_CAM, VP, { light: false, selected: 3 }))).toBe(false)
  })

  it('de-clutter: a lower-priority label overlapping a placed one is skipped', () => {
    expect(keeps(computeFrame(CLASH(5, 1), NEAR_CAM, VP, { selected: -1 }), 0, 1)).toBe(true)
  })

  it('CONTROL: with the priorities swapped the same check fails (it reads priority, not order)', () => {
    expect(keeps(computeFrame(CLASH(1, 5), NEAR_CAM, VP, { selected: -1 }), 0, 1)).toBe(false)
  })

  it('the selection is never skipped, even as the lower priority of two overlapping labels', () => {
    expect(keeps(computeFrame(CLASH(5, 1), NEAR_CAM, VP, { selected: 1 }), 1, 0)).toBe(true)
  })

  it('CONTROL: the same dot, not selected, is skipped, so the same check fails', () => {
    expect(keeps(computeFrame(CLASH(5, 1), NEAR_CAM, VP, { selected: -1 }), 1, 0)).toBe(false)
  })

  it('a dot just off the left edge (culled) whose long label reaches into view gets its label', () => {
    expect(offLeftLabelled(computeFrame(EDGE, NEAR_CAM, VP, { selected: -1 }))).toBe(true)
  })

  it('CONTROL: labelling only drawn dots fails the same check', () => {
    expect(offLeftLabelled(onlyDrawn(computeFrame(EDGE, NEAR_CAM, VP, { selected: -1 })))).toBe(false)
  })

  it('maxLabels caps the labels, keeping the highest priorities', () => {
    expect(cappedToTop(computeFrame(MANY, NEAR_CAM, VP, { selected: -1, maxLabels: 10 }), 10)).toBe(true)
  })

  it('CONTROL: without the cap all thirty are labelled, so the same check fails', () => {
    expect(cappedToTop(computeFrame(MANY, NEAR_CAM, VP, { selected: -1 }), 10)).toBe(false)
  })
})


// ── MO2: a grown cell stays grown while panning at one zoom step (R1-3) ──────────────────────────────────────────
describe('MO2: clusters do not regroup on a pixel of panning', () => {
  it("a previous frame's grown cell is kept at the same zoom step, and dropped at another", () => {
    const n = 4000
    const xy = new Float32Array(2 * n)
    for (let i = 0; i < n; i++) { xy[2 * i] = (i % 80) * 6; xy[2 * i + 1] = Math.floor(i / 80) * 6 }
    const scene = {
      n, xy, r: new Float32Array(n).fill(2), container: new Uint8Array(n), collapsed: new Uint8Array(n), dim: new Uint8Array(n),
      label: new Array(n).fill(''), count: new Uint32Array(n), priority: new Float32Array(n), m: 0, ends: new Uint32Array(0), kind: new Uint8Array(0),
    }
    const vp = { width: 1200, height: 800 }
    const first = computeFrame(scene, { x: 240, y: 150, k: 0.3 }, vp)
    expect(first.cell).toBeTruthy()
    const grown = { base: first.cell.base, world: first.cell.base * 8 }
    const next = computeFrame(scene, { x: 241, y: 150, k: 0.3 }, vp, { prevCell: grown })
    expect(next.cell.world).toBe(grown.world)
    const zoomed = computeFrame(scene, { x: 241, y: 150, k: 0.12 }, vp, { prevCell: grown })
    expect(zoomed.cell.base).not.toBe(grown.base)
    expect(zoomed.cell.world).not.toBe(grown.world)
  })
})
