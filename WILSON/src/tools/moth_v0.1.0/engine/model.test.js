// =============================================================================
// model.test.js — the graph model (MO2a, the brief's item 1; model.js header).
// Pins: identities `kind:rowId` and `kind|from|to`, and a graph that does not
// depend on row order; the project's root row is the project dot; a closed
// container is one dot with its counts, its lines re-routed and summed; a
// kind not on show leaves no dot and no line; relations to rows not read are
// dropped; stray files, folder loops and unknown parents; focus as mist; the
// light's size (catalogueSize) from the catalogue alone; layout input and
// positions as data. Each rule has a PLANTED control: the same check run on a
// naive or broken stand-in must fail, so a green run cannot mean it was blind.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import {
  buildGraph, indexCatalogue, catalogueSize, nodeId, edgeId, toLayoutInput, positionsToData, defaultRadius, EDGE_CODE,
} from './model.js'
import { generateCatalogue, seededRandom } from './fixtures.js'

// ── Rows in MR-5 / 0041 shape ───────────────────────────────────────────────
const isle = (id) => ({ id, title: id.toUpperCase(), is_personal: false, is_mine: false, is_private: false,
  my_project_role: 'member', is_staffed: true, can_write: true, updated_at: null })
const folder = (id, parent_id, kind = 'custom') => ({ id, parent_id, kind, entity_type: null, slug: id, label: id,
  path: '', sort_order: 0, updated_at: null })
const file = (id, project_id, folder_id, tags = []) => ({ id, project_id, folder_id, name: id, mime_type: 'image/png',
  size_bytes: 1, kind: 'source', document_kind: null, description: null, tags, storage_provider: 'supabase',
  storage_path: `p/${id}`, thumbnail_url: null, duration_sec: null, source_modified_at: null, uploaded_at: null, updated_at: null })
const rel = (a, b, label = null, ka = 'file', kb = 'file') => ({ source: { kind: ka, id: a }, target: { kind: kb, id: b }, label })

/** p1: root r1 > fa > fb; x1 in the root, x2 in fa, x3 in fb, x4 with folder_id null. p2: root r2 > fc; y1 in fc. */
function hand() {
  return {
    islands: [isle('p1'), isle('p2')],
    folders: {
      p1: [folder('r1', null, 'root'), folder('fa', 'r1', 'category'), folder('fb', 'fa')],
      p2: [folder('r2', null, 'root'), folder('fc', 'r2', 'category')],
    },
    files: {
      p1: [file('x1', 'p1', 'r1', ['Shots', ' shots ']), file('x2', 'p1', 'fa', ['shots', 'code']),
        file('x3', 'p1', 'fb', ['shots']), file('x4', 'p1', null, ['code'])],
      p2: [file('y1', 'p2', 'fc', ['shots'])],
    },
    // x2-y1 and x3-y1 both become fa-fc once fa and fc are closed; x2-x3 is then a self-loop; x1-x4 stays one line.
    relations: [rel('x2', 'y1', 'see also'), rel('x3', 'y1', 'cites'), rel('x2', 'x3', 'inside'), rel('x1', 'x4', 'lone')],
  }
}
/** A bigger catalogue; every third relation also runs the other way, so summed lines come from both directions. */
function generated() {
  const c = generateCatalogue({ seed: 11, projects: 3, foldersPerProject: 8, filesPerProject: 20, tagsPerFile: 2, relations: 30 })
  c.relations.push(...c.relations.filter((_, i) => i % 3 === 0).map((r) => ({ source: r.target, target: r.source, label: 'back' })))
  return c
}

const ALL = { expanded: 'all' }
const PROJECTS_OPEN = { expanded: ['project:p1', 'project:p2'] } // fa and fc closed
const ids = (g) => g.nodes.map((n) => n.id)
const node = (g, id) => g.nodes.find((n) => n.id === id)
function viewsFor(c) {
  const P = c.islands.map((i) => nodeId('project', i.id))
  const F = Object.values(c.folders).flat().filter((f) => f.kind !== 'root').map((f) => nodeId('folder', f.id))
  return [ALL, {}, { expanded: P }, { expanded: [P[0], F[0]] }, { expanded: P, focus: { id: P[0], depth: 2 } },
    { nodeKinds: ['project', 'file', 'tag'], expanded: 'all' }]
}

function shuffleRows(c, seed) {
  const rand = seededRandom(seed)
  const mix = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  const keyed = (o) => Object.fromEntries(mix(Object.keys(o)).map((k) => [k, mix(o[k])]))
  return { islands: mix(c.islands), folders: keyed(c.folders), files: keyed(c.files), relations: mix(c.relations) }
}
const reverseRelations = (c) => ({ ...c, relations: [...c.relations].reverse() })
const PERTURB = [(c) => shuffleRows(c, 1), (c) => shuffleRows(c, 2), reverseRelations, (c) => reverseRelations(shuffleRows(c, 3))]
/** The rule: the same rows in any order give the same output. */
const orderFree = (build, c, perturb = PERTURB) => perturb.every((p) => isDeepStrictEqual(build(c), build(p(c))))

/** The rule: a dot is kind:rowId; a line is kind|from|to (a related line's ends in id order); sorted, unique. */
const lineKey = (e) => { const [a, b] = e.kind === 'related_to' ? [e.source, e.target].sort() : [e.source, e.target]; return `${e.kind}|${a}|${b}` }
const ascending = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] < x)
const identitiesHold = (g) => g.nodes.every((n) => n.id === `${n.kind}:${n.rowId}`) && g.edges.every((e) => e.id === lineKey(e))
  && ascending(ids(g)) && ascending(g.edges.map((e) => e.id))

describe('identities and order', () => {
  it('a dot is kind:rowId, a line kind|from|to, output sorted by id, in every view', () => {
    expect([nodeId('folder', 'fa'), edgeId('lives_in', 'file:x', 'folder:fa')]).toEqual(['folder:fa', 'lives_in|file:x|folder:fa'])
    for (const c of [hand(), generated()]) for (const v of viewsFor(c)) expect(identitiesHold(buildGraph(c, v))).toBe(true)
  })

  it('CONTROL: the identity check catches bare row ids, a related line keyed by arrival order, and unsorted dots', () => {
    const g = buildGraph(generated(), ALL)
    expect(identitiesHold({ ...g, nodes: g.nodes.map((n) => ({ ...n, id: n.rowId })) })).toBe(false)
    expect(identitiesHold({ ...g, edges: g.edges.map((e) => ({ ...e, id: `${e.kind}|${e.source}|${e.target}` })) })).toBe(false)
    expect(identitiesHold({ ...g, nodes: [...g.nodes].reverse() })).toBe(false)
  })

  it('shuffled islands, folders, files and relations, and reversed relation lists, give deep-equal graphs; one index serves every view', () => {
    for (const c of [hand(), generated()]) {
      const idx = indexCatalogue(c)
      for (const v of viewsFor(c)) {
        expect(orderFree((x) => buildGraph(x, v), c)).toBe(true)
        expect(buildGraph(c, v, idx)).toEqual(buildGraph(c, v))
      }
    }
  })

  it('CONTROL: the order check catches dots listed in row order and a summed line that keeps the first direction seen', () => {
    const c = generated()
    expect(orderFree((x) => Object.values(x.files).flat().map((r) => nodeId('file', r.id)), c)).toBe(false)
    const firstDirection = (x) => {
      const g = buildGraph(x, ALL)
      const first = new Map()
      for (const r of x.relations) {
        const ends = [nodeId('file', r.source.id), nodeId('file', r.target.id)]
        const k = lineKey({ kind: 'related_to', source: ends[0], target: ends[1] })
        if (!first.has(k)) first.set(k, ends)
      }
      return { ...g, edges: g.edges.map((e) => (first.has(e.id) ? { ...e, source: first.get(e.id)[0], target: first.get(e.id)[1] } : e)) }
    }
    expect(orderFree(firstDirection, c, [reverseRelations])).toBe(false)
  })
})

// ── The root row, counts and closed containers ─────────────────────────────
const rootIsProject = (c, g) => {
  const idx = indexCatalogue(c)
  return !idx.rows.has('folder:r1') && !idx.rows.has('folder:r2') && !g.nodes.some((n) => ['r1', 'r2'].includes(n.rowId))
    && ['file:x1', 'folder:fa', 'file:x4'].every((id) => node(g, id)?.parent === 'project:p1') && node(g, 'project:p1')?.count === 6
}
// [count, directCount]: p1 holds fa, fb, x1..x4; fa holds fb, x2, x3. A tag's count is the files carrying it.
const COUNTS = { 'project:p1': [6, 3], 'folder:fa': [3, 2], 'folder:fb': [1, 1], 'project:p2': [2, 1], 'folder:fc': [1, 1], 'tag:shots': [4, 0], 'tag:code': [2, 0] }
const countsMatch = (g) => Object.entries(COUNTS).every(([id, [c, d]]) => node(g, id)?.count === c && node(g, id)?.directCount === d)
const closedDot = (g, id, count, direct, inside) => {
  const n = node(g, id)
  return n?.collapsed === true && n.count === count && n.directCount === direct
    && inside.every((x) => !node(g, x) && g.edges.every((e) => e.source !== x && e.target !== x))
}
const FA_INSIDE = ['folder:fb', 'file:x2', 'file:x3']
/** A related line drawn as given: one per relation, unsummed (the stand-ins below use it). */
const line = (source, target, label) => ({ id: `related_to|${source}|${target}`, kind: 'related_to', source, target, weight: 1, label })
const directOnly = (g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, count: n.directCount })) })
/** fa-fc carries two relations (weight 2, no label), x2-x3 folded into fa is dropped, x1-x4 keeps its label, fa's two shots files sum. */
const reroutedAndSummed = (g) => {
  const across = g.edges.filter((e) => e.kind === 'related_to' && [e.source, e.target].sort().join() === 'folder:fa,folder:fc')
  const lone = g.edges.find((e) => e.id === 'related_to|file:x1|file:x4')
  return across.length === 1 && across[0].weight === 2 && across[0].label === null && g.edges.every((e) => e.source !== e.target)
    && lone?.weight === 1 && lone.label === 'lone' && g.edges.find((e) => e.id === 'tagged_with|folder:fa|tag:shots')?.weight === 2
}

describe('the root row, counts and closed containers', () => {
  it('the root row is the project dot: never its own dot, not counted, and what is filed under it hangs on the project', () => {
    const c = hand()
    for (const v of [ALL, PROJECTS_OPEN]) expect(rootIsProject(c, buildGraph(c, v))).toBe(true)
  })

  it('CONTROL: the root check catches a root row read as an ordinary folder', () => {
    const c = hand()
    c.folders.p1[0].kind = 'category'
    expect(rootIsProject(c, buildGraph(c, ALL))).toBe(false)
  })

  it('a closed container is one dot: count = everything read beneath it, directCount = its children, contents absent', () => {
    const c = hand()
    expect(countsMatch(buildGraph(c, ALL))).toBe(true)
    expect(closedDot(buildGraph(c, PROJECTS_OPEN), 'folder:fa', 3, 2, FA_INSIDE)).toBe(true)
  })

  it('CONTROL: the count checks catch a direct-children-only counter and a container left open', () => {
    const c = hand()
    expect(countsMatch(directOnly(buildGraph(c, ALL)))).toBe(false)
    expect(closedDot(directOnly(buildGraph(c, PROJECTS_OPEN)), 'folder:fa', 3, 2, FA_INSIDE)).toBe(false)
    expect(closedDot(buildGraph(c, { expanded: [...PROJECTS_OPEN.expanded, 'folder:fa'] }), 'folder:fa', 3, 2, FA_INSIDE)).toBe(false)
  })

  it('lines are re-routed to the closed dot and summed; self-loops dropped; a summed relation loses its label', () => {
    expect(reroutedAndSummed(buildGraph(hand(), PROJECTS_OPEN))).toBe(true)
  })

  it('CONTROL: the re-route check catches no summing, a kept self-loop, a kept label and an unsummed tag line', () => {
    const g = buildGraph(hand(), PROJECTS_OPEN)
    const isAcross = (e) => e.id === 'related_to|folder:fa|folder:fc'
    const broken = [
      { ...g, edges: [...g.edges.filter((e) => !isAcross(e)), line('folder:fa', 'folder:fc', 'see also'), line('folder:fa', 'folder:fc', 'cites')] },
      { ...g, edges: [...g.edges, line('folder:fa', 'folder:fa', 'inside')] },
      { ...g, edges: g.edges.map((e) => (isAcross(e) ? { ...e, label: 'see also' } : e)) },
      { ...g, edges: g.edges.map((e) => (e.kind === 'tagged_with' ? { ...e, weight: 1 } : e)) },
    ]
    for (const b of broken) expect(reroutedAndSummed(b)).toBe(false)
  })
})

// ── What is drawn ──────────────────────────────────────────────────────────
const NO_FILES = ['project', 'folder', 'tag']
const EXPANSIONS = [[], ['project:p1', 'project:p2'], ['project:p1', 'project:p2', 'folder:fa', 'folder:fb', 'folder:fc'], 'all']
/** With files off: no file dot, and only lives-in lines between dots that exist (every tag and relation here hangs on a file). */
const leavesNoFileTrace = (g) => {
  const has = new Set(ids(g))
  return g.nodes.every((n) => n.kind !== 'file') && g.edges.every((e) => e.kind === 'lives_in' && has.has(e.source) && has.has(e.target))
}
const BOGUS = [rel('x1', 'ghost', 'g'), rel('x1', 'x2', 'w', 'widget'), rel('x1', 'finance', 'f', 'file', 'tag'), rel('x2', 'z1', 'stray')]
const withBogus = () => { const c = hand(); c.relations.push(...BOGUS, rel('x4', ' SHOTS ', 'about', 'file', 'tag')); return c }
const onlyRealEnds = (g) => {
  const has = new Set(ids(g))
  const related = g.edges.filter((e) => e.kind === 'related_to')
  return g.edges.every((e) => has.has(e.source) && has.has(e.target)) && !related.some((e) => /ghost|widget|finance|z1/.test(e.id))
    && related.length === 5 && related.some((e) => e.id === 'related_to|file:x4|tag:shots' && e.label === 'about')
}
function withStrays() {
  const c = hand()
  c.folders.p9 = [folder('r9', null, 'root'), folder('f9', 'r9')]
  c.files.p9 = [file('z1', 'p9', 'f9', ['stray'])] // keyed under a project not in islands
  c.files.p1.push(file('z2', 'p2', 'fa', ['foreign'])) // keyed under p1, says p2
  return c
}
const ignoresStrays = (build) => isDeepStrictEqual(build(hand()), build(withStrays()))
/** l1 > l3 > l2 > l1 is a loop; k1 hangs under l2; u1's parent was never read; w2 names a folder never read. */
const REAL = { l1: 'l3', l2: 'l1', l3: 'l2', k1: 'l2' }
const LOOP = ['l1', 'l2', 'l3']
const loopCat = () => ({
  islands: [isle('p1')],
  folders: { p1: [folder('r1', null, 'root'), ...Object.entries(REAL).map(([f, p]) => folder(f, p)), folder('u1', 'nope')] },
  files: { p1: [file('w1', 'p1', 'k1'), file('w2', 'p1', 'nope')] },
  relations: [],
})
const SHUFFLES = [1, 2, 3, 4, 5, 6].map((s) => (c) => shuffleRows(c, s))
const loopCutOnce = (g) => {
  const up = (id) => node(g, id)?.parent
  const cut = LOOP.filter((f) => up(nodeId('folder', f)) === 'project:p1')
  const reaches = g.nodes.every((n) => { let a = n.id; for (let s = 0; s < 20 && a !== 'project:p1'; s++) a = up(a); return a === 'project:p1' })
  return cut.length === 1 && reaches && Object.keys(REAL).filter((f) => !cut.includes(f)).every((f) => up(nodeId('folder', f)) === nodeId('folder', REAL[f]))
    && up('folder:u1') === 'project:p1' && up('file:w2') === 'project:p1' && up('file:w1') === 'folder:k1'
}

describe('what is drawn', () => {
  it('a kind not on show makes no dot and no line, even inside a closed container, whatever is expanded (it still counts)', () => {
    for (const expanded of EXPANSIONS) expect(leavesNoFileTrace(buildGraph(hand(), { nodeKinds: NO_FILES, expanded }))).toBe(true)
    expect(node(buildGraph(hand(), { nodeKinds: NO_FILES, ...PROJECTS_OPEN }), 'folder:fa').count).toBe(3)
  })

  it('CONTROL: the no-trace check catches a stand-in that hides file dots after building (tag weights stay on fa)', () => {
    const g = buildGraph(hand(), PROJECTS_OPEN)
    expect(leavesNoFileTrace({ ...g, nodes: g.nodes.filter((n) => n.kind !== 'file') })).toBe(false)
  })

  it('a relation to a row not read, of an unknown kind or to an uncarried tag is dropped; a carried tag is kept', () => {
    expect(onlyRealEnds(buildGraph(withBogus(), ALL))).toBe(true)
  })

  it('CONTROL: the drop check catches a stand-in that draws every relation as given', () => {
    const c = withBogus()
    const g = buildGraph(c, ALL)
    const asGiven = c.relations.map((r) => line(`${r.source.kind}:${r.source.id}`, `${r.target.kind}:${r.target.id}`, r.label))
    expect(onlyRealEnds({ ...g, edges: [...g.edges.filter((e) => e.kind !== 'related_to'), ...asGiven] })).toBe(false)
  })

  it('files keyed under a project not in islands, or carrying a foreign project_id, are ignored (graph and size alike)', () => {
    for (const build of [(c) => buildGraph(c, ALL), (c) => buildGraph(c, {}), catalogueSize]) expect(ignoresStrays(build)).toBe(true)
  })

  it('CONTROL: the stray check catches a stand-in that takes every file row it is handed', () => {
    expect(ignoresStrays((c) => Object.values(c.files).flat().map((r) => r.id))).toBe(false)
  })

  it('a folder loop is cut at one link, others keep their real parents, an unknown parent files at the project; same under shuffle', () => {
    expect(loopCutOnce(buildGraph(loopCat(), ALL))).toBe(true)
    expect(orderFree((c) => buildGraph(c, ALL), loopCat(), SHUFFLES)).toBe(true)
  })

  it('CONTROL: the loop checks catch a stand-in that files the whole loop at the root, one that keeps raw parents, and a row-order cut', () => {
    const g = buildGraph(loopCat(), ALL)
    const reparent = (fn) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, parent: fn(n) ?? n.parent })) })
    expect(loopCutOnce(reparent((n) => (LOOP.includes(n.rowId) ? 'project:p1' : null)))).toBe(false)
    expect(loopCutOnce(reparent((n) => (REAL[n.rowId] ? nodeId('folder', REAL[n.rowId]) : null)))).toBe(false)
    expect(loopCutOnce(reparent((n) => (n.rowId === 'u1' ? 'folder:nope' : null)))).toBe(false)
    expect(orderFree((c) => c.folders.p1.find((f) => LOOP.includes(f.id)).id, loopCat(), SHUFFLES)).toBe(false)
  })
})

// ── Focus ───────────────────────────────────────────────────────────────────
const FULL = ids(buildGraph(hand(), ALL))
const focused = (depth, id = 'folder:fb', v = ALL) => buildGraph(hand(), { ...v, focus: { id, depth } })
/** Reference distances over the drawn lines, both ways. */
function distances(g, from) {
  const adj = new Map(g.nodes.map((n) => [n.id, []]))
  for (const e of g.edges) { adj.get(e.source)?.push(e.target); adj.get(e.target)?.push(e.source) }
  const d = new Map([[from, 0]])
  for (const q = [from]; q.length;) { const x = q.shift(); for (const y of adj.get(x) || []) if (!d.has(y)) { d.set(y, d.get(x) + 1); q.push(y) } }
  return d
}
/** The rule: nothing removed; a dot is dim exactly when it is further than `depth` steps; some of each. */
const mistAt = (g, depth, from = 'folder:fb') => {
  const d = distances(g, from)
  return isDeepStrictEqual(ids(g), FULL) && g.focus?.depth === depth && g.nodes.every((n) => n.dim === !(d.get(n.id) <= depth))
    && g.nodes.some((n) => n.dim) && g.nodes.some((n) => !n.dim)
}
const noMist = (g) => g.focus === null && g.nodes.every((n) => n.dim === false)

describe('focus', () => {
  it('depth 1 and 2 dim everything further: mist, not removal', () => {
    expect(focused(1).nodes.filter((n) => !n.dim).map((n) => n.id)).toEqual(['file:x3', 'folder:fa', 'folder:fb'])
    expect(mistAt(focused(1), 1) && mistAt(focused(2), 2)).toBe(true)
  })

  it('CONTROL: the mist check catches a focus that removes far dots and one that ignores the depth', () => {
    const g = focused(2)
    expect(mistAt({ ...g, nodes: g.nodes.filter((n) => !n.dim) }, 2)).toBe(false)
    expect(mistAt({ ...focused(1), focus: { ...focused(1).focus, depth: 2 } }, 2)).toBe(false)
  })

  it('the depth is clamped to 1..2', () => {
    for (const [raw, want] of [[0, 1], [-3, 1], ['x', 1], [1.2, 1], [1.6, 2], [2.6, 2], [5, 2], [99, 2]]) expect(mistAt(focused(raw), want)).toBe(true)
  })

  it('CONTROL: the clamp check catches an unclamped walk (depth 5 lights everything, depth 0 only the focus)', () => {
    const g = focused(2)
    const d = distances(g, 'folder:fb')
    // The stand-in reports the clamped depth but walks the raw one, so only the mist can give it away.
    const walk = (k, reported) => ({ ...g, focus: { ...g.focus, depth: reported }, nodes: g.nodes.map((n) => ({ ...n, dim: !(d.get(n.id) <= k) })) })
    expect(mistAt(walk(5, 2), 2)).toBe(false)
    expect(mistAt(walk(0, 1), 1)).toBe(false)
  })

  it('an unknown focus id (or one hidden in a closed container) gives focus null and nothing dim', () => {
    for (const g of [focused(1, 'file:nope'), focused(2, 'file:x3', PROJECTS_OPEN), focused(1, 'project:p9')]) expect(noMist(g)).toBe(true)
  })

  it('CONTROL: the no-mist check catches a focus on a dot that exists', () => {
    expect(noMist(focused(1, 'file:x3'))).toBe(false)
  })
})

// ── The light's size ────────────────────────────────────────────────────────
const refSize = (c) => c.islands.length + Object.values(c.folders).flat().filter((f) => f.kind !== 'root').length + Object.values(c.files).flat().length
/** The rule: the same size whatever view is built in between, and it is islands + folders + files, root rows not counted. */
const steadySize = (sizeOf, c) => new Set(viewsFor(c).map((v) => sizeOf(c, v))).size === 1 && sizeOf(c, ALL) === refSize(c)
const engineSize = (c, v) => { buildGraph(c, v); return catalogueSize(c) }
const BIG = () => generateCatalogue({ seed: 5, projects: 3, foldersPerProject: 12, filesPerProject: 40 })

describe("the light's size", () => {
  it('catalogueSize depends only on the catalogue and counts islands, folders and files without root rows', () => {
    expect(catalogueSize(hand())).toBe(10)
    for (const c of [hand(), BIG()]) expect(steadySize(engineSize, c)).toBe(true)
  })

  it('CONTROL: the size check catches a size that follows the view and one that counts root rows', () => {
    for (const c of [hand(), BIG()]) {
      expect(steadySize((x, v) => buildGraph(x, v).nodes.length, c)).toBe(false)
      expect(steadySize((x) => catalogueSize(x) + x.islands.length, c)).toBe(false)
    }
  })
})

// ── Layout input and positions ──────────────────────────────────────────────
const layoutMatches = (g, input) => input.nodes.length === g.nodes.length && input.links.length === g.edges.length
  && input.nodes.every((n, i) => n.id === g.nodes[i].id && n.parent === (g.nodes[i].parent ?? null) && n.r === defaultRadius(g.nodes[i]) && n.loose === (g.nodes[i].kind === 'tag'))
  && input.links.every(([s, t, code], k) => input.nodes[s].id === g.edges[k].source && input.nodes[t].id === g.edges[k].target && code === EDGE_CODE[g.edges[k].kind])
  && new Set(input.links.map((l) => l[2])).size === 3
const radiusOk = (rf) => rf({ kind: 'file' }) === 3.5 && rf({ kind: 'tag', count: 9 }) === 5 && rf({ kind: 'folder', count: 0 }) === 5
  && Math.abs(rf({ kind: 'project', count: 100 }) - 21) < 1e-9 && rf({ kind: 'folder', count: 4 }) < rf({ kind: 'folder', count: 9 })
const IDS = ['a', 'b', 'c', 'd', 'e']
const XY = [1.234, 5.678, NaN, 1, 3, Infinity, 7.06, -2.04, 9, 9]
const OPTS = { pinned: (i) => i === 3, placed: (i) => i !== 4 }
const positionsOk = (toData) => isDeepStrictEqual(toData(IDS, XY, OPTS), { a: { x: 1.2, y: 5.7 }, d: { x: 7.1, y: -2, pinned: true } })
  && isDeepStrictEqual(toData(['a'], [1.04, 2]), { a: { x: 1, y: 2 } })

describe('layout input and positions', () => {
  it('toLayoutInput keeps the graph order and maps edge kinds to EDGE_CODE', () => {
    expect(EDGE_CODE).toEqual({ lives_in: 0, tagged_with: 1, related_to: 2 })
    for (const g of [buildGraph(hand(), ALL), buildGraph(generated(), viewsFor(generated())[2])]) expect(layoutMatches(g, toLayoutInput(g))).toBe(true)
  })

  it('CONTROL: the layout check catches reordered dots and a stand-in that codes every line as lives-in', () => {
    const g = buildGraph(hand(), ALL)
    const rev = [...g.nodes].reverse()
    const at = new Map(rev.map((n, i) => [n.id, i]))
    const reordered = { nodes: rev.map((n) => ({ id: n.id, parent: n.parent ?? null, r: defaultRadius(n), loose: n.kind === 'tag' })), links: g.edges.map((e) => [at.get(e.source), at.get(e.target), EDGE_CODE[e.kind]]) }
    expect(layoutMatches(g, reordered)).toBe(false)
    const input = toLayoutInput(g)
    expect(layoutMatches(g, { ...input, links: input.links.map(([s, t]) => [s, t, 0]) })).toBe(false)
  })

  it('defaultRadius: a file 3.5, a tag 5, a container 5 + 1.6 sqrt(count), so it grows with what is inside', () => {
    expect(radiusOk(defaultRadius)).toBe(true)
  })

  it('CONTROL: the radius check catches a radius that ignores the count', () => {
    expect(radiusOk((n) => (n.kind === 'file' ? 3.5 : 5))).toBe(false)
  })

  it('positionsToData rounds to a tenth, marks pinned, leaves out unplaced or non-finite dots', () => {
    expect(positionsOk(positionsToData)).toBe(true)
  })

  it('CONTROL: the positions check catches raw copying and a stand-in that forgets placed()', () => {
    const raw = (ids, xy) => Object.fromEntries(ids.map((id, i) => [id, { x: xy[2 * i], y: xy[2 * i + 1] }]))
    const unplaced = (ids, xy, o = {}) => positionsToData(ids, xy, { ...o, placed: () => true })
    expect(positionsOk(raw)).toBe(false)
    expect(positionsOk(unplaced)).toBe(false)
  })
})
