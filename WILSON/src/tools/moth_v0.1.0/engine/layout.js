// =============================================================================
// layout.js — the two layouts (MO2a, the brief's item 2; PLAN_MOTH §5
// Session 2 step 3): a free force layout for exploring and a radial tree
// (the project at the centre, folders branching out).
//
// It runs inside the layout worker (layoutWorkerCore.js) and is the only
// module that imports the D3 modules (d3-force 3.0.0, d3-hierarchy 3.1.2,
// pinned exactly in package.json), so they ship in the worker's chunk only.
// Nothing here touches the DOM or a timer: the simulation's own d3-timer is
// stopped the moment it is made and every tick is called by hand, so a
// settled layout costs nothing.
//
// Layouts persist (brief §2: "if a person drags a cluster to a corner, it
// stays there, saved with the view"):
//   * a view reopened with every dot's place saved does not move at all;
//   * when some dots are new, the saved ones are held still while the new
//     ones find their places beside their parents, then released;
//   * dragging a dot (pin) moves its neighbourhood (two steps) and holds the
//     rest of the world still.
// Positions are plain data (model.js positionsToData) for a later session to
// save with the view.
// =============================================================================

import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'
import { hierarchy, tree } from 'd3-hierarchy'
import { seededRandom } from './model.js'

const FORCE_DEFAULTS = Object.freeze({
  linkDistance: Object.freeze([30, 70, 90]), // by model.js EDGE_CODE
  linkStrength: Object.freeze([0.9, 0.12, 0.08]),
  charge: -60,
  chargeDistanceMax: 500,
  theta: 0.9,
  collidePad: 2,
  gravity: 0.04,
  alphaMin: 0.001,
  velocityDecay: 0.45,
  warmAlpha: 0.3, // new dots joining a saved layout, or an explicit re-layout
  pinAlpha: 0.12, // a drag: enough for the neighbourhood to follow, no more
  pinReach: 2, // how many steps from a dragged dot may move
  seed: 1,
})

const RADIAL_DEFAULTS = Object.freeze({ ringGap: 80, pad: 2 })

const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)

/**
 * A force layout, ticked by hand.
 *   createForceLayout({ nodes, links, positions, options })
 *   nodes: [{ id, parent, r, loose }], links: [[s, t, code]] (model.js toLayoutInput)
 *   positions: { [id]: { x, y, pinned? } } (model.js positionsToData), or null
 */
export function createForceLayout({ nodes, links, positions = null, options = {} }) {
  const o = { ...FORCE_DEFAULTS, ...options }
  const rand = seededRandom(o.seed)
  const n = nodes.length
  const indexOf = new Map(nodes.map((nd, i) => [nd.id, i]))
  const pins = new Set() // dots a person put somewhere: held for good
  const holds = new Set() // dots held only for the current run
  const warm = new Set() // of those, the saved dots held while new ones settle (not a drag's)
  const sim = nodes.map((nd, i) => ({ index: i, r: nd.r || 4 }))
  let saved = 0
  nodes.forEach((nd, i) => {
    const p = positions ? positions[nd.id] : null
    if (!finite(p)) return
    sim[i].x = p.x
    sim[i].y = p.y
    saved++
    if (p.pinned) { sim[i].fx = p.x; sim[i].fy = p.y; pins.add(i) }
  })

  // A new dot starts beside its nearest ancestor that has a place, however
  // deep the new chain is (resolved recursively, a loop guarded).
  const placing = new Set()
  const place = (i) => {
    if (Number.isFinite(sim[i].x)) return true
    if (placing.has(i)) return false
    placing.add(i)
    const pi = nodes[i].parent != null ? indexOf.get(nodes[i].parent) : undefined
    const ok = pi !== undefined && place(pi)
    if (ok) {
      const a = rand() * 2 * Math.PI
      sim[i].x = sim[pi].x + Math.cos(a) * 20
      sim[i].y = sim[pi].y + Math.sin(a) * 20
    }
    placing.delete(i)
    return ok
  }
  if (saved > 0) for (let i = 0; i < n; i++) place(i)

  const simulation = forceSimulation(sim).stop() // the d3-timer stops here; ticks are manual
  simulation
    .randomSource(rand)
    .alphaMin(o.alphaMin)
    .velocityDecay(o.velocityDecay)
    .force('link', forceLink(links.map(([s, t, k]) => ({ source: s, target: t, k })))
      .distance((l) => o.linkDistance[l.k] ?? 60)
      .strength((l) => o.linkStrength[l.k] ?? 0.1))
    .force('charge', forceManyBody().strength(o.charge).theta(o.theta).distanceMax(o.chargeDistanceMax))
    .force('collide', forceCollide((d) => d.r + o.collidePad).iterations(1))
    .force('x', forceX(0).strength(o.gravity))
    .force('y', forceY(0).strength(o.gravity))

  const hold = (i) => {
    if (pins.has(i) || holds.has(i)) return
    sim[i].fx = sim[i].x
    sim[i].fy = sim[i].y
    holds.add(i)
  }
  const releaseHolds = () => {
    for (const i of holds) { sim[i].fx = null; sim[i].fy = null }
    holds.clear()
  }

  if (n > 0 && saved === n) {
    simulation.alpha(0) // every place is saved: nothing moves, nothing ticks
  } else if (saved > 0) {
    // Hold the saved dots; only the new ones move, then the holds go.
    nodes.forEach((nd, i) => { if (positions && finite(positions[nd.id])) { hold(i); warm.add(i) } })
    simulation.alpha(o.warmAlpha)
  }
  // A fresh layout (nothing saved) is still forming until its first run settles. A press then pins the one dot
  // and holds nothing else, or the run would end with the graph frozen half-formed (R1-17).
  // MO2 review round 2: also a layout where only some places are saved (new dots opened into a saved view, or a
  // Lay out again with pins): it is forming until its first run settles.
  let forming = saved < n
  // A drag's holds go when the next drag starts, so each drag moves its own neighbourhood (R1-18).
  const releaseDragHolds = () => {
    for (const i of [...holds]) if (!warm.has(i)) { sim[i].fx = null; sim[i].fy = null; holds.delete(i) }
  }

  // Neighbourhood for a drag: dots within pinReach steps of i.
  const adj = Array.from({ length: n }, () => [])
  for (const [s, t] of links) { adj[s].push(t); adj[t].push(s) }
  const near = (i) => {
    const seen = new Set([i])
    let frontier = [i]
    for (let d = 0; d < o.pinReach; d++) {
      const next = []
      for (const a of frontier) for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); next.push(b) }
      frontier = next
    }
    return seen
  }
  const holdAllBut = (keep) => { for (let j = 0; j < n; j++) if (!keep.has(j)) hold(j) }

  return {
    n,
    tick(count = 1) {
      simulation.tick(count)
      if (forming && simulation.alpha() < simulation.alphaMin()) forming = false
      // A warm run's holds go when it settles (MO2 review round 1, R1-18 after saved places): the saved dots stay
      // where they are, and a later drag moves its own neighbourhood.
      if (warm.size && simulation.alpha() < simulation.alphaMin()) {
        for (const i of warm) if (holds.has(i)) { sim[i].fx = null; sim[i].fy = null; holds.delete(i) }
        warm.clear()
      }
    },
    alpha: () => simulation.alpha(),
    settled: () => simulation.alpha() < simulation.alphaMin(),
    /** An explicit re-layout: everything but the pins may move. */
    reheat(alpha = o.warmAlpha) { releaseHolds(); warm.clear(); simulation.alpha(Math.max(simulation.alpha(), alpha)) },
    /** A person put dot i at (x, y): it stays; its neighbourhood follows; the rest holds. */
    pin(i, x, y) {
      const s = sim[i]
      if (!s) return
      if (holds.has(i)) holds.delete(i)
      pins.add(i)
      s.fx = s.x = x
      s.fy = s.y = y
      s.vx = s.vy = 0
      if (!forming) { releaseDragHolds(); holdAllBut(near(i)) }
      simulation.alpha(Math.max(simulation.alpha(), o.pinAlpha))
    },
    unpin(i) {
      const s = sim[i]
      if (!s || !pins.has(i)) return
      pins.delete(i)
      s.fx = null
      s.fy = null
      if (!forming) { releaseDragHolds(); holdAllBut(near(i)) }
      simulation.alpha(Math.max(simulation.alpha(), o.pinAlpha))
    },
    /** The run is over: dots held for it are free again (pins stay). */
    releaseHolds,
    write(xy) {
      for (let i = 0; i < n; i++) { xy[2 * i] = sim[i].x; xy[2 * i + 1] = sim[i].y }
      return xy
    },
    pinned: (i) => pins.has(i),
    held: (i) => holds.has(i),
  }
}

/**
 * The radial tree: one island at the centre (or a hidden root over several),
 * each level of the hierarchy a ring further out, siblings kept together.
 * Each ring's radius is the smallest that keeps its neighbouring dots apart
 * (by their radii) and clear of the ring inside it; loose dots (tags) sit on
 * a ring beyond the outermost, in id order. Returns a Float32Array of x, y in
 * node order.
 */
export function radialTree({ nodes, options = {} }) {
  const o = { ...RADIAL_DEFAULTS, ...options }
  const xy = new Float32Array(nodes.length * 2)
  const radius = (i) => nodes[i].r || 4
  const indexOf = new Map(nodes.map((nd, i) => [nd.id, i]))
  const kids = new Map()
  const tops = []
  const loose = []
  nodes.forEach((nd, i) => {
    if (nd.loose) { loose.push(i); return }
    const p = nd.parent != null ? indexOf.get(nd.parent) : undefined
    if (p === undefined || nodes[p].loose) { tops.push(i); return }
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p).push(i)
  })
  const byNodeId = (a, b) => (nodes[a].id < nodes[b].id ? -1 : nodes[a].id > nodes[b].id ? 1 : 0)
  const guard = new Set()
  const build = (i) => {
    guard.add(i)
    const c = (kids.get(i) || []).filter((j) => !guard.has(j)).sort(byNodeId)
    return { i, children: c.map((j) => build(j)) }
  }
  tops.sort(byNodeId)
  const single = tops.length === 1
  const rootData = single ? build(tops[0]) : { i: -1, children: tops.map((t) => build(t)) }
  const root = hierarchy(rootData, (d) => d.children)
  tree().size([2 * Math.PI, 1]).separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(root)

  // Rings, inside out.
  const levels = []
  root.each((d) => {
    if (d.data.i < 0) return
    ;(levels[d.depth] ||= []).push(d)
  })
  const ringFor = (members, angleOf, inner, innerMaxR) => {
    if (!members.length) return inner
    const maxR = Math.max(...members.map((d) => radius(d.data !== undefined ? d.data.i : d)))
    let R = inner + Math.max(o.ringGap, innerMaxR + maxR + o.pad)
    if (members.length > 1) {
      const sorted = members.slice().sort((a, b) => angleOf(a) - angleOf(b))
      for (let k = 0; k < sorted.length; k++) {
        const a = sorted[k]
        const b = sorted[(k + 1) % sorted.length]
        let gap = angleOf(b) - angleOf(a)
        if (k === sorted.length - 1) gap += 2 * Math.PI
        gap = Math.min(Math.PI, Math.max(1e-6, gap))
        const ia = a.data !== undefined ? a.data.i : a
        const ib = b.data !== undefined ? b.data.i : b
        R = Math.max(R, (radius(ia) + radius(ib) + o.pad) / (2 * Math.sin(gap / 2)))
      }
    }
    return R
  }
  let inner = 0
  let innerMaxR = 0
  for (let depth = 0; depth < levels.length; depth++) {
    const members = levels[depth]
    if (!members) continue
    const isCentre = depth === 0 // the single island
    const R = isCentre ? 0 : ringFor(members, (d) => d.x, inner, innerMaxR)
    for (const d of members) {
      xy[2 * d.data.i] = R * Math.cos(d.x - Math.PI / 2)
      xy[2 * d.data.i + 1] = R * Math.sin(d.x - Math.PI / 2)
    }
    inner = R
    innerMaxR = Math.max(...members.map((d) => radius(d.data.i)))
  }
  if (loose.length) {
    loose.sort(byNodeId)
    const angle = new Map(loose.map((i, j) => [i, (2 * Math.PI * j) / loose.length]))
    const R = ringFor(loose, (i) => angle.get(i), inner, innerMaxR)
    for (const i of loose) {
      const a = angle.get(i) - Math.PI / 2
      xy[2 * i] = R * Math.cos(a)
      xy[2 * i + 1] = R * Math.sin(a)
    }
  }
  return xy
}
