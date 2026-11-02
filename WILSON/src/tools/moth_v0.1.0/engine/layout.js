// =============================================================================
// layout.js — the two layouts (MO2a, the brief's item 2; PLAN_MOTH §5
// Session 2 step 3): a free force layout for exploring and a radial tree
// (the project at the centre, folders branching out).
//
// Pure apart from the D3 modules (d3-force 3.0.0, d3-hierarchy 3.1.2, pinned
// exactly in package.json). These run inside the layout worker
// (layoutWorkerCore.js); nothing here touches the DOM or a timer: the
// simulation's own d3-timer is stopped the moment it is made and every tick
// is called by hand, so a settled layout costs nothing.
//
// Positions are plain data, { [nodeId]: { x, y, pinned? } }, for a later
// session to save with the view (brief §2: "Layouts persist").
// =============================================================================

import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'
import { hierarchy, tree } from 'd3-hierarchy'
import { seededRandom } from './fixtures.js'

export const EDGE_CODE = Object.freeze({ lives_in: 0, tagged_with: 1, related_to: 2 })

export const FORCE_DEFAULTS = Object.freeze({
  linkDistance: Object.freeze([30, 70, 90]), // by EDGE_CODE
  linkStrength: Object.freeze([0.9, 0.12, 0.08]),
  charge: -60,
  chargeDistanceMax: 500,
  theta: 0.9,
  collidePad: 2,
  gravity: 0.04,
  alphaMin: 0.001,
  velocityDecay: 0.45,
  warmAlpha: 0.3,
  seed: 1,
})

export const RADIAL_DEFAULTS = Object.freeze({ ringGap: 80 })

/** A node's world radius from its count: containers grow with what is inside. */
export const defaultRadius = (node) => (node.kind === 'file' ? 3.5 : node.kind === 'tag' ? 5 : 5 + 1.6 * Math.sqrt(node.count || 0))

/**
 * The graph (model.js buildGraph) as layout input, in the graph's own node
 * order (sorted by id), which the renderer shares.
 *   nodes: [{ id, parent, r, loose }]   (loose: not part of the hierarchy, a tag)
 *   links: [[sourceIndex, targetIndex, edgeCode]]
 */
export function toLayoutInput(graph, radiusOf = defaultRadius) {
  const index = new Map()
  graph.nodes.forEach((n, i) => index.set(n.id, i))
  const nodes = graph.nodes.map((n) => ({ id: n.id, parent: n.parent ?? null, r: radiusOf(n), loose: n.kind === 'tag' }))
  const links = []
  for (const e of graph.edges) {
    const s = index.get(e.source)
    const t = index.get(e.target)
    if (s === undefined || t === undefined) continue
    links.push([s, t, EDGE_CODE[e.kind] ?? 2])
  }
  return { nodes, links }
}

const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)

/**
 * A force layout, ticked by hand.
 *   createForceLayout({ nodes, links, positions, options })
 * New dots with no saved position start beside their parent (when it has
 * one), so a reopened view keeps its shape and new things appear where they
 * live. Pinned dots (dragged by a person) stay where they were put.
 */
export function createForceLayout({ nodes, links, positions = null, options = {} }) {
  const o = { ...FORCE_DEFAULTS, ...options }
  const rand = seededRandom(o.seed)
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]))
  let placed = 0
  const sim = nodes.map((n, i) => {
    const p = positions ? positions[n.id] : null
    const s = { index: i, r: n.r || 4 }
    if (finite(p)) {
      s.x = p.x
      s.y = p.y
      placed++
      if (p.pinned) { s.fx = p.x; s.fy = p.y }
    }
    return s
  })
  // Beside the parent, for the dots that have no place yet (parents first).
  if (placed > 0) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        if (Number.isFinite(sim[i].x)) continue
        const pi = nodes[i].parent != null ? indexOf.get(nodes[i].parent) : undefined
        if (pi === undefined || !Number.isFinite(sim[pi].x)) continue
        const a = rand() * 2 * Math.PI
        sim[i].x = sim[pi].x + Math.cos(a) * 20
        sim[i].y = sim[pi].y + Math.sin(a) * 20
      }
    }
  }
  const simLinks = links.map(([s, t, k]) => ({ source: s, target: t, k }))
  const simulation = forceSimulation(sim).stop() // the d3-timer stops here; ticks are manual
  simulation
    .randomSource(rand)
    .alphaMin(o.alphaMin)
    .velocityDecay(o.velocityDecay)
    .force('link', forceLink(simLinks).id((d) => d.index)
      .distance((l) => o.linkDistance[l.k] ?? 60)
      .strength((l) => o.linkStrength[l.k] ?? 0.1))
    .force('charge', forceManyBody().strength(o.charge).theta(o.theta).distanceMax(o.chargeDistanceMax))
    .force('collide', forceCollide((d) => d.r + o.collidePad).iterations(1))
    .force('x', forceX(0).strength(o.gravity))
    .force('y', forceY(0).strength(o.gravity))
  // A view reopened with most of its places known starts warm, not from chaos.
  if (nodes.length > 0 && placed / nodes.length >= 0.5) simulation.alpha(o.warmAlpha)

  return {
    n: nodes.length,
    tick(count = 1) { simulation.tick(count) },
    alpha: () => simulation.alpha(),
    settled: () => simulation.alpha() < simulation.alphaMin(),
    reheat(alpha = o.warmAlpha) { simulation.alpha(Math.max(simulation.alpha(), alpha)) },
    pin(i, x, y) { const s = sim[i]; if (!s) return; s.fx = s.x = x; s.fy = s.y = y; s.vx = s.vy = 0 },
    unpin(i) { const s = sim[i]; if (!s) return; s.fx = null; s.fy = null },
    write(xy) {
      for (let i = 0; i < sim.length; i++) { xy[2 * i] = sim[i].x; xy[2 * i + 1] = sim[i].y }
      return xy
    },
    pinned: (i) => sim[i] != null && sim[i].fx != null,
  }
}

/**
 * The radial tree: one island at the centre (or a hidden root over several),
 * each level of the hierarchy a ring further out, siblings kept together.
 * Loose dots (tags) sit on a ring beyond the deepest level, in id order.
 * Returns a Float32Array of x, y in node order.
 */
export function radialTree({ nodes, options = {} }) {
  const o = { ...RADIAL_DEFAULTS, ...options }
  const xy = new Float32Array(nodes.length * 2)
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]))
  const kids = new Map()
  const tops = []
  const loose = []
  nodes.forEach((n, i) => {
    if (n.loose) { loose.push(i); return }
    const p = n.parent != null ? indexOf.get(n.parent) : undefined
    if (p === undefined || nodes[p].loose) { tops.push(i); return }
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p).push(i)
  })
  const byNodeId = (a, b) => (nodes[a].id < nodes[b].id ? -1 : nodes[a].id > nodes[b].id ? 1 : 0)
  const build = (i, guard) => {
    if (guard.has(i)) return { i, children: [] }
    guard.add(i)
    const c = (kids.get(i) || []).slice().sort(byNodeId)
    return { i, children: c.map((j) => build(j, guard)) }
  }
  const guard = new Set()
  tops.sort(byNodeId)
  const single = tops.length === 1
  const rootData = single ? build(tops[0], guard) : { i: -1, children: tops.map((t) => build(t, guard)) }
  const root = hierarchy(rootData, (d) => d.children)
  const height = Math.max(1, root.height)
  tree()
    .size([2 * Math.PI, height * o.ringGap])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(root)
  let maxR = 0
  root.each((d) => {
    if (d.data.i < 0) return
    const r = d.y
    maxR = Math.max(maxR, r)
    xy[2 * d.data.i] = r * Math.cos(d.x - Math.PI / 2)
    xy[2 * d.data.i + 1] = r * Math.sin(d.x - Math.PI / 2)
  })
  loose.sort(byNodeId)
  const R = maxR + o.ringGap
  loose.forEach((i, j) => {
    const a = (2 * Math.PI * j) / Math.max(1, loose.length) - Math.PI / 2
    xy[2 * i] = R * Math.cos(a)
    xy[2 * i + 1] = R * Math.sin(a)
  })
  return xy
}

/** Positions as plain data for saving: { [nodeId]: { x, y, pinned? } }. */
export function positionsToData(ids, xy, pinned = () => false) {
  const out = {}
  for (let i = 0; i < ids.length; i++) {
    const x = xy[2 * i]
    const y = xy[2 * i + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out[ids[i]] = pinned(i) ? { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, pinned: true } : { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  }
  return out
}
